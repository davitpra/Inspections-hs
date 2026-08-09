import {
  presignUploadResponseSchema,
  type PresignUploadRequest,
  type UploadContentType,
} from '@hs/contracts';

import { sessionClient } from '../api/client';
import type { SessionClient } from '../auth/session-client';
import { db, photoBlob, type OfflineDatabase, type PhotoRow } from './db';

/**
 * Las fotos: guardadas al tomarlas, subidas por separado y ANTES del envío.
 *
 * ADR-001 / ADR-006 — el envío referencia object keys y nunca lleva bytes. Si el envío
 * falla, las fotos ya están del otro lado; si una foto falla, se reintenta sin
 * arriesgar el formulario. Las dos mitades de esa frase son el motivo de que esto sea
 * un módulo aparte del outbox.
 */

export interface CapturePhotoInput {
  client_submission_id: string;
  item_key: string;
  blob: Blob;
}

export interface UploadDeps {
  database?: OfflineDatabase;
  client?: SessionClient;
  /** El PUT directo al bucket. No pasa por la API (D7). */
  put?: (url: string, blob: Blob, contentType: string) => Promise<Response>;
}

/**
 * Guardar la foto es lo primero que pasa, y pasa sin red.
 *
 * `upload_state: 'pending'` desde el momento de la captura: la foto existe en el
 * dispositivo aunque el inspector esté en modo avión tres horas más, y el borrador la
 * muestra sin pedir nada.
 */
export async function capturePhoto(
  input: CapturePhotoInput,
  database: OfflineDatabase = db,
): Promise<PhotoRow> {
  const row: PhotoRow = {
    id: crypto.randomUUID(),
    client_submission_id: input.client_submission_id,
    item_key: input.item_key,
    bytes: await input.blob.arrayBuffer(),
    content_type: input.blob.type || 'image/jpeg',
    object_key: null,
    upload_state: 'pending',
    attempts: 0,
    last_error: null,
    captured_at: new Date().toISOString(),
  };

  await database.photos.add(row);

  return row;
}

export async function photosOfDraft(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<PhotoRow[]> {
  const rows = await database.photos
    .where('client_submission_id')
    .equals(clientSubmissionId)
    .toArray();

  return rows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

/** Las object keys por `item_key`, que es la forma que el envío lleva. */
export async function uploadedKeysByItem(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<Record<string, string[]>> {
  const photos = await photosOfDraft(clientSubmissionId, database);
  const byItem: Record<string, string[]> = {};

  for (const photo of photos) {
    if (!photo.object_key) continue;

    byItem[photo.item_key] = [...(byItem[photo.item_key] ?? []), photo.object_key];
  }

  return byItem;
}

/**
 * Sube UNA foto: pide su presign y hace el PUT.
 *
 * D7 — el presign se pide justo antes del PUT y no al capturar ni por lote: las URLs
 * firmadas expiran, y pedirlas por lote al reconectar hace que la última venza mientras
 * sube la primera.
 *
 * **Una foto ya subida no vuelve a pedir presign ni a subir.** La comprobación es lo
 * primero que pasa, antes de tocar la red: reintentar el outbox veinte veces no puede
 * costar veinte subidas de la misma foto.
 */
export async function uploadPhoto(
  photoId: string,
  scheduledInspectionId: string,
  deps: UploadDeps = {},
): Promise<PhotoRow | null> {
  const database = deps.database ?? db;
  const client = deps.client ?? sessionClient;
  const put = deps.put ?? defaultPut;

  // Se lee la fila entera y se reescribe entera con `put`. Un `update` parcial es de
  // todos modos un leer-modificar-escribir, pero deja los bytes en manos del cursor del
  // motor; hacerlo explícito los mantiene en las nuestras, que es lo que garantiza que
  // un intento fallido no pueda dejar una foto sin su contenido.
  const photo = await database.photos.get(photoId);
  if (!photo) return null;
  if (photo.upload_state === 'uploaded' && photo.object_key) return photo;

  const request: PresignUploadRequest = {
    scheduled_inspection_id: scheduledInspectionId,
    item_key: photo.item_key,
    content_type: photo.content_type as UploadContentType,
    content_length: photo.bytes.byteLength,
  };

  try {
    const presign = await client.request<unknown>('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!presign.ok) throw new Error(presign.message);

    const signed = presignUploadResponseSchema.parse(presign.value);
    const response = await put(signed.url, photoBlob(photo), photo.content_type);

    if (!response.ok) throw new Error(`El bucket respondió ${response.status}`);

    await database.photos.put({
      ...photo,
      object_key: signed.object_key,
      upload_state: 'uploaded',
      last_error: null,
    });
  } catch (error) {
    // El fallo se guarda en LA FOTO. No toca a las otras ni a las respuestas: una foto
    // que falla es una foto que se reintenta, no un recorrido que se pierde.
    await database.photos.put({
      ...photo,
      upload_state: 'failed',
      attempts: photo.attempts + 1,
      last_error: error instanceof Error ? error.message : String(error),
    });
  }

  return (await database.photos.get(photoId)) ?? null;
}

/**
 * Intenta las que faltan. Devuelve cuántas quedaron sin subir.
 *
 * Cada foto se intenta por separado y un fallo no corta el bucle: cinco fotos con una
 * que falla suben cuatro, y la quinta se reintenta en la corrida siguiente sin que el
 * inspector la vuelva a sacar.
 */
export async function uploadPendingPhotos(
  clientSubmissionId: string,
  scheduledInspectionId: string,
  deps: UploadDeps = {},
): Promise<number> {
  const database = deps.database ?? db;
  const photos = await photosOfDraft(clientSubmissionId, database);

  for (const photo of photos) {
    if (photo.upload_state === 'uploaded' && photo.object_key) continue;

    await uploadPhoto(photo.id, scheduledInspectionId, deps);
  }

  return countPending(await photosOfDraft(clientSubmissionId, database));
}

export function countPending(photos: readonly PhotoRow[]): number {
  return photos.filter((photo) => photo.upload_state !== 'uploaded' || !photo.object_key).length;
}

/** Borrar una foto del borrador. Local y antes del envío: el bucket no se toca nunca. */
export async function discardPhoto(
  photoId: string,
  database: OfflineDatabase = db,
): Promise<void> {
  const photo = await database.photos.get(photoId);

  // Una foto ya subida NO se borra del dispositivo: su object key es lo que el envío
  // referencia, y ADR-006 no le da a esta aplicación forma de borrar del bucket.
  if (!photo || photo.upload_state === 'uploaded') return;

  await database.photos.delete(photoId);
}

async function defaultPut(url: string, blob: Blob, contentType: string): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: blob,
  });
}
