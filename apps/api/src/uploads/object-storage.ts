import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadContentType } from '@hs/contracts';

/**
 * ADR-006 — El almacenamiento de objetos, y la única operación que la aplicación
 * puede pedirle: subir.
 *
 * **La credencial de esta aplicación no lleva `DeleteObject`, y eso es del bucket, no
 * de este archivo.** Acá no hay método para borrar porque no existe un camino de
 * código que lo intente; que además la política del bucket lo niegue es lo que hace
 * que el día que alguien escriba ese método, falle. Las dos mitades hacen falta: el
 * bucket tiene versioning activado, así que ni siquiera una sobreescritura pierde la
 * foto que respalda un hallazgo.
 *
 * El PUT va DIRECTO del dispositivo al bucket y no pasa por la API: una foto de una
 * planta sin señal no tiene por qué atravesar dos saltos, y el proceso de Node no
 * tiene por qué sostener un multipart de 20 MB mientras el inspector espera.
 */

export interface PresignedUpload {
  url: string;
  object_key: string;
  expires_at: string;
}

export interface PresignInput {
  site_id: string;
  scheduled_inspection_id: string;
  content_type: UploadContentType;
  content_length: number;
}

/** Lo mismo, para la foto de un hallazgo de entrada manual (design D9). */
export interface PresignManualInput {
  site_id: string;
  draft_finding_id: string;
  content_type: UploadContentType;
  content_length: number;
}

/** Lo mismo, para la evidencia de una acción correctiva (etapa 5, design D9). */
export interface PresignActionInput {
  site_id: string;
  action_id: string;
  content_type: UploadContentType;
  content_length: number;
}

/**
 * Corta a propósito (design D7). La URL se pide justo antes del PUT y se usa en el
 * acto; una expiración larga es una URL de escritura circulando por el `fetch` de un
 * teléfono más tiempo del que hace falta.
 */
const DEFAULT_TTL_SECONDS = 300;

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor() {
    const config = readConfig();

    this.bucket = config.bucket;
    this.ttlSeconds = config.ttlSeconds;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Los bucket S3-compatibles (MinIO, Garage, R2 con endpoint propio) sirven por
      // path y no por subdominio. Con virtual-hosted style el PUT iría a un host que
      // no resuelve, y el error aparecería en el dispositivo y no acá.
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /**
   * Firma un PUT para UNA foto y devuelve dónde va a quedar.
   *
   * **La key la deriva el servidor y no se acepta una del cliente** (design D7). Dejar
   * que el dispositivo la eligiera es dejar que escriba dentro del prefijo de otra
   * inspección, o de otra planta: el prefijo es lo único que separa las dos.
   */
  async presignPut(input: PresignInput): Promise<PresignedUpload> {
    return this.sign(
      deriveObjectKey(input.site_id, input.scheduled_inspection_id),
      input.content_type,
      input.content_length,
    );
  }

  /**
   * La misma firma, en el prefijo del hallazgo manual. Mismo principio que arriba: la
   * key la deriva el servidor, y el cliente solo dice de qué borrador es la foto.
   */
  async presignManualPut(input: PresignManualInput): Promise<PresignedUpload> {
    return this.sign(
      deriveManualObjectKey(input.site_id, input.draft_finding_id),
      input.content_type,
      input.content_length,
    );
  }

  /**
   * La misma firma, en el prefijo de una acción correctiva. La acción ya existe, así
   * que su id es la carpeta y el cliente sigue sin elegir dónde escribe.
   */
  async presignActionPut(input: PresignActionInput): Promise<PresignedUpload> {
    return this.sign(
      deriveActionObjectKey(input.site_id, input.action_id),
      input.content_type,
      input.content_length,
    );
  }

  private async sign(
    objectKey: string,
    contentType: UploadContentType,
    contentLength: number,
  ): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: this.ttlSeconds },
    );

    return {
      url,
      object_key: objectKey,
      expires_at: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    };
  }
}

/**
 * `{site_id}/{scheduled_inspection_id}/{uuid}`.
 *
 * El sitio va primero para que una política del bucket pueda acotarse por prefijo el
 * día que haga falta, y el UUID último para que dos fotos del mismo ítem no puedan
 * colisionar — ni siquiera si el dispositivo reintenta una subida que sí había
 * terminado.
 */
export function deriveObjectKey(siteId: string, scheduledInspectionId: string): string {
  return `${siteId}/${scheduledInspectionId}/${randomUUID()}`;
}

/**
 * `{site_id}/manual/{draft_finding_id}/{uuid}` — la foto de un hallazgo de entrada
 * manual (design D9).
 *
 * Un hallazgo manual no cuelga de ninguna inspección programada, así que no hay un
 * `scheduled_inspection_id` que ponga en el segundo segmento. El literal `manual/`
 * ocupa ese lugar a propósito: sin él, el `draft_finding_id` sería un uuid en la misma
 * posición que el de una inspección y los dos prefijos dejarían de distinguirse.
 *
 * Esta función dice DÓNDE SE ESCRIBE. Qué se acepta lo dice `foreignManualKeys` en
 * `findings/object-key.ts`, escrito por separado y a propósito: son dos afirmaciones
 * que tienen que coincidir, y un test las compara. Mismo criterio que con
 * `objectKeyPrefix` de `inspections/submission.ts`.
 */
export function deriveManualObjectKey(siteId: string, draftFindingId: string): string {
  return `${siteId}/manual/${draftFindingId}/${randomUUID()}`;
}

/**
 * `{site_id}/actions/{action_id}/{uuid}` — la evidencia de una acción correctiva
 * (etapa 5, design D9).
 *
 * La más simple de las tres: cuando se sube evidencia la acción YA EXISTE, así que su
 * id sirve de carpeta y no hace falta un borrador que el cliente invente antes. El
 * literal `actions/` cumple el mismo papel que `manual/`: sin él, el `action_id` sería
 * un uuid en la misma posición que el de una inspección programada.
 */
export function deriveActionObjectKey(siteId: string, actionId: string): string {
  return `${siteId}/actions/${actionId}/${randomUUID()}`;
}

interface ObjectStorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  ttlSeconds: number;
}

/**
 * Sin bucket ni credencial no se arranca, por el mismo motivo que
 * `BETTER_AUTH_SECRET`: un default acá sería un default en producción, y lo que se
 * perdería es la foto que respalda un hallazgo.
 */
function readConfig(): ObjectStorageConfig {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY tienen que estar definidas. Ver .env.example.',
    );
  }

  return {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    ttlSeconds: Number(process.env.S3_UPLOAD_TTL_SECONDS ?? DEFAULT_TTL_SECONDS),
  };
}
