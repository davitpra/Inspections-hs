import { z } from 'zod';
import {
  publishedTemplateSchema,
  publishedTemplateSummarySchema,
  publishedTemplateVersionSchema,
  templateDraftSchema,
  templateDraftSummarySchema,
  type CreateTemplateDraft,
  type PublishedTemplate,
  type PublishedTemplateSummary,
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

/**
 * Siembra un borrador con la última versión publicada de una plantilla, para corregirla.
 *
 * ES IDEMPOTENTE: si la plantilla ya tiene una revisión viva, el servidor devuelve esa. La
 * pantalla navega al borrador que venga sin preguntar cuál de las dos cosas pasó, porque para
 * el coordinador son la misma —llegar a la corrección en curso—.
 */
export async function reviseTemplate(templateId: string): Promise<TemplateDraft> {
  return post(`/templates/${templateId}/revisions`, undefined, (value) =>
    templateDraftSchema.parse(value),
  );
}

/**
 * El catálogo publicado TAL COMO SE ADMINISTRA: las retiradas vienen también.
 *
 * No es `listTemplates` de `inspections.ts` con un campo de más. Aquella contesta qué se
 * puede programar y la mira `/scheduling`; esta contesta qué existe, y es la única que
 * puede mostrar una plantilla retirada — sin ella, retirarla la borraría de la pantalla y
 * nadie podría volver a activarla.
 */
export async function listPublishedTemplates(): Promise<PublishedTemplateSummary[]> {
  return get('/templates/published', (value) =>
    z.array(publishedTemplateSummarySchema).parse(value),
  );
}

/**
 * Retirar una plantilla del catálogo, y devolverla.
 *
 * Las dos contestan 204 y no la fila: lo que cambia es el listado entero y además lo que
 * `/scheduling` ofrece, así que la pantalla invalida las dos claves en vez de parchear una
 * fila con la mitad de lo que pasó.
 */
export async function deactivateTemplate(templateId: string): Promise<void> {
  await send('POST', `/templates/${templateId}/deactivate`, {}, () => undefined);
}

export async function reactivateTemplate(templateId: string): Promise<void> {
  await send('POST', `/templates/${templateId}/reactivate`, {}, () => undefined);
}

/** La lectura de plantillas publicadas también es online, como el resto de este archivo. */
export async function getPublishedTemplateVersion(id: string): Promise<PublishedTemplateVersion> {
  return get(`/templates/versions/${id}`, (value) => publishedTemplateVersionSchema.parse(value));
}

export type { PublishedTemplateSummary, TemplateDraft, TemplateDraftSummary };
