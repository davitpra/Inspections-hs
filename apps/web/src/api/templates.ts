import { z } from 'zod';
import {
  publishedTemplateSchema,
  publishedTemplateVersionSchema,
  templateDraftSchema,
  templateDraftSummarySchema,
  type CreateTemplateDraft,
  type PublishedTemplate,
  type PublishedTemplateVersion,
  type SaveTemplateDraft,
  type TemplateDraft,
  type TemplateDraftSummary,
} from '@hs/contracts';

import { get, post, send } from './request';

/**
 * La autoría de plantillas.
 *
 * Archivo propio y no un rincón de `inspections.ts`, donde vive `listTemplates`: aquella
 * pregunta cuáles se pueden PROGRAMAR y la contesta cualquiera; estas escriben un documento
 * y son del coordinador. Compartir archivo habría sugerido que comparten algo más.
 *
 * **ONLINE, sin excepción.** Nada de esto pasa por Dexie ni por la cola de envío. ADR-001
 * acepta perder un borrador de INSPECCIÓN porque la alternativa es un protocolo de
 * sincronización para trabajo de campo sin señal; escribir una plantilla no es ninguna de
 * las dos cosas —se hace sentado, y puede llevar días—, así que el borrador vive en el
 * servidor y punto.
 *
 * `discardTemplateDraft` no devuelve nada: el servidor contesta 204. `parse` recibe el
 * `undefined` del cuerpo vacío y no lo mira, que es lo correcto —el contrato de esa ruta es
 * que no hay cuerpo—, pero `parse` sigue siendo obligatorio y por eso está escrito.
 */

export async function listTemplateDrafts(): Promise<TemplateDraftSummary[]> {
  return get('/templates/drafts', (value) => z.array(templateDraftSummarySchema).parse(value));
}

export async function getTemplateDraft(id: string): Promise<TemplateDraft> {
  return get(`/templates/drafts/${id}`, (value) => templateDraftSchema.parse(value));
}

export async function createTemplateDraft(body: CreateTemplateDraft): Promise<TemplateDraft> {
  return send('POST', '/templates/drafts', body, (value) => templateDraftSchema.parse(value));
}

/**
 * `PUT` y el documento entero: reordenar dos secciones y agregar un ítem no es una secuencia
 * de parches que tenga sentido aplicar a medias.
 *
 * El documento y el alcance viajan juntos: cambiar cualquiera de los dos es una edición
 * completa que el autor confirma con un solo guardado. Si el borrador ya no existe o fue
 * descartado, el servidor devuelve el mismo error de no encontrado que para cualquier lectura.
 */
export async function saveTemplateDraft(
  id: string,
  body: SaveTemplateDraft,
): Promise<TemplateDraft> {
  return send('PUT', `/templates/drafts/${id}`, body, (value) => templateDraftSchema.parse(value));
}

export async function discardTemplateDraft(id: string): Promise<void> {
  await send('POST', `/templates/drafts/${id}/discard`, {}, () => undefined);
}

/** Publica el borrador guardado; el POST no necesita cuerpo porque el servidor ya tiene el documento. */
export async function publishTemplateDraft(id: string): Promise<PublishedTemplate> {
  return post(`/templates/drafts/${id}/publish`, undefined, (value) =>
    publishedTemplateSchema.parse(value),
  );
}

/** La lectura de plantillas publicadas también es online, como el resto de este archivo. */
export async function getPublishedTemplateVersion(id: string): Promise<PublishedTemplateVersion> {
  return get(`/templates/versions/${id}`, (value) => publishedTemplateVersionSchema.parse(value));
}

export type { TemplateDraft, TemplateDraftSummary };
