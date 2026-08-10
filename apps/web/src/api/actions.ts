import {
  actionListSchema,
  actionSchema,
  notificationSchema,
  presignUploadResponseSchema,
  type Action,
  type EvidenceInput,
  type Notification,
  type PresignUploadResponse,
  type TransitionRequest,
} from '@hs/contracts';
import { z } from 'zod';

import { sessionClient } from './client';

/**
 * El cliente de acciones correctivas (etapa 5).
 *
 * **Todo lo que vuelve se parsea contra el contrato, no se castea.** Es lo que hace que
 * un `kind` de notificación que el servidor tenga y el cliente no —una migración a medio
 * desplegar— falle donde alguien lo ve, en vez de renderizar una tarjeta vacía (D11).
 *
 * A diferencia de la captura de inspecciones, esto es ONLINE (design D15): no hay
 * Dexie, no hay outbox y no hay cola. Una acción correctiva se ejecuta con red; el
 * offline existe porque una inspección ocurre en 48 acres sin señal, y ejecutar una
 * acción no tiene esa restricción.
 */

async function get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const result = await sessionClient.request<unknown>(path);

  if (!result.ok) throw new Error(result.message);

  return parse(result.value);
}

async function post<T>(path: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
  const result = await sessionClient.request<unknown>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

  if (!result.ok) throw new Error(result.message);

  return parse(result.value);
}

export async function listActions(): Promise<Action[]> {
  return get('/actions', (value) => actionListSchema.parse(value));
}

export async function getAction(id: string): Promise<Action> {
  return get(`/actions/${id}`, (value) => actionSchema.parse(value));
}

export async function createAction(
  findingId: string,
  body: { assignee_person_id: string; description: string; remediation_group_id?: string },
): Promise<Action> {
  return post(`/findings/${findingId}/actions`, body, (value) => actionSchema.parse(value));
}

export async function transitionAction(id: string, body: TransitionRequest): Promise<Action> {
  return post(`/actions/${id}/transitions`, body, (value) => actionSchema.parse(value));
}

export async function listNotifications(): Promise<Notification[]> {
  return get('/notifications', (value) => z.array(notificationSchema).parse(value));
}

/**
 * Sube un archivo de evidencia y devuelve su object key.
 *
 * Dos pasos, como en la captura: el servidor firma un PUT contra el bucket y el archivo
 * va directo, sin pasar por la API (ADR-006). **La key la deriva el servidor**: el
 * cliente no elige dónde escribe, que es lo único que separa el prefijo de una acción
 * del de otra.
 */
export async function uploadEvidence(actionId: string, file: File): Promise<string> {
  const presigned = await post<PresignUploadResponse>(
    '/uploads/presign/action',
    {
      action_id: actionId,
      content_type: file.type,
      content_length: file.size,
    },
    (value) => presignUploadResponseSchema.parse(value),
  );

  const response = await fetch(presigned.url, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': file.type },
  });

  if (!response.ok) {
    throw new Error(`The evidence could not be uploaded (${response.status})`);
  }

  return presigned.object_key;
}

export type { Action, EvidenceInput, Notification };
