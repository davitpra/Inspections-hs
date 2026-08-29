import { z } from 'zod';

import {
  SECTION_KEY_PATTERN,
  templateDocumentSchema,
  templateDraftDocumentSchema,
} from './template-document.js';

/**
 * Requisitos §7 — Las plantillas, tal como se ELIGEN y tal como se ESCRIBEN.
 *
 * Dos cosas distintas conviven acá, y conviene leerlas como tales:
 *
 *  - `templateOptionSchema` es el DTO de listado: lo que hace falta para que el
 *    coordinador elija una plantilla **publicada** al crear una regla de recurrencia.
 *  - El resto es el **borrador** (etapa 8, primera mitad): un documento que se está
 *    escribiendo, que puede estar incompleto y que todavía no es ninguna versión.
 *
 * La publicación convierte un borrador en una nueva plantilla publicada. Su respuesta es un
 * DTO pequeño (`publishedTemplateSchema`), porque la pantalla solo necesita identificar lo que
 * acaba de quedar congelado.
 *
 * **Por qué no vive en `template-document.ts`**: ese archivo tiene la forma del
 * documento —congelado o en borrador—, la que interpreta `packages/forms` dentro del
 * service worker. Un DTO de pantalla ahí lo arrastraría a un lugar donde no pinta nada.
 *
 * **Sin `site_id` y sin recorte por alcance**, porque `template` no lleva ninguno de los
 * dos: una plantilla es contenido de referencia de la organización, no un dato de sitio.
 * Si llevara `site_id`, la misma inspección mensual existiría dos veces con dos juegos
 * de `item_key` y «la misma guarda falta en las dos plantas» dejaría de ser una pregunta
 * que se puede hacer. La respuesta de este listado es idéntica para las dos plantas.
 */

/**
 * Una plantilla ofrecible para programar.
 *
 * SOLO LAS QUE TIENEN VERSIÓN PUBLICADA. Una regla sobre una plantilla sin
 * `template_version` la rechaza el servidor con `template_not_publishable`, así que
 * ofrecerla sería ofrecer un error.
 *
 * `latest_version` y `latest_version_id` los resuelve **la misma expresión** que usa el
 * planificador para congelar una inspección al abrir el período. Si fueran dos, la
 * pantalla podría decir `2` mientras la inspección abre contra la `3`, sin que nada
 * fallara y sin que nadie se enterara.
 *
 * `latest_published_at` sale de esa MISMA fila que aporta la versión. No se calcula con
 * `max(published_at)`: un máximo separado podría combinar la versión 3 con la fecha de la
 * versión 1 y hacer que la pantalla nombre dos publicaciones distintas como una sola.
 */
export const templateOptionSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  latest_version: z.int().positive(),
  latest_version_id: z.uuid(),
  latest_published_at: z.string(),
});

export type TemplateOption = z.infer<typeof templateOptionSchema>;

/**
 * La misma plantilla, pero TAL COMO SE ADMINISTRA y no tal como se elige.
 *
 * La diferencia con `templateOptionSchema` no es un campo de más: son dos poblaciones.
 * El listado de arriba ofrece lo que se puede programar, y una plantilla retirada no
 * está ahí — ofrecerla sería ofrecer un error. La consola de plantillas necesita
 * exactamente lo contrario: ver también las retiradas, porque si desaparecieran de la
 * pantalla al retirarlas no habría forma de volver a activarlas nunca.
 *
 * Por eso `deactivated_at` viaja acá y no allá. Que el DTO de programar lo llevara sería
 * invitar a que la pantalla de reglas decidiera por su cuenta qué ofrecer, que es
 * justamente la decisión que toma el servidor.
 */
export const publishedTemplateSummarySchema = templateOptionSchema.extend({
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});

export type PublishedTemplateSummary = z.infer<typeof publishedTemplateSummarySchema>;

/** La baja de una plantilla no acepta una fecha fabricada por el cliente. */
export const deactivateTemplateSchema = z.strictObject({});

export type DeactivateTemplate = z.infer<typeof deactivateTemplateSchema>;

/** La reactivación tampoco acepta una fecha fabricada por el cliente. */
export const reactivateTemplateSchema = z.strictObject({});

export type ReactivateTemplate = z.infer<typeof reactivateTemplateSchema>;

/** Archivar y restaurar tampoco aceptan fechas fabricadas por el cliente. */
export const archiveTemplateSchema = z.strictObject({});
export type ArchiveTemplate = z.infer<typeof archiveTemplateSchema>;

export const restoreTemplateSchema = z.strictObject({});
export type RestoreTemplate = z.infer<typeof restoreTemplateSchema>;

/** Identidad de la versión creada al publicar un borrador. */
export const publishedTemplateSchema = z.strictObject({
  template_id: z.uuid(),
  template_version_id: z.uuid(),
  version: z.int().positive(),
});

export type PublishedTemplate = z.infer<typeof publishedTemplateSchema>;

/**
 * La versión publicada completa: las dos identidades viajan con el documento porque una
 * versión sola no se puede nombrar ni enlazar sin volver a resolver su plantilla. La fecha
 * queda como `string` para conservar el timestamp que guardó PostgreSQL sin reinterpretarlo
 * en el huso horario del dispositivo.
 */
export const publishedTemplateVersionSchema = z.strictObject({
  template_id: z.uuid(),
  template_version_id: z.uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  version: z.int().positive(),
  published_at: z.string(),
  document: templateDocumentSchema,
});

export type PublishedTemplateVersion = z.infer<typeof publishedTemplateVersionSchema>;

/**
 * La `key` de un borrador. Mismo patrón que `template.key`, porque es la que va a
 * heredar cuando se publique: aceptar acá una que allá se rechaza sería descubrir el
 * problema en el único momento en que ya no se puede arreglar sin empezar de nuevo.
 */
const templateKeySchema = z
  .string()
  .regex(SECTION_KEY_PATTERN, 'key: minúsculas, dígitos y "." o "-" como separadores');

/**
 * Un problema que le impide a un borrador publicarse.
 *
 * `path` ubica el problema dentro del documento (`['sections', 2, 'items', 0]`) y lo
 * calcula `draftIssues` en `@hs/forms`, así que la pantalla y el servidor reportan lo
 * mismo sin ponerse de acuerdo.
 */
export const draftIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string().min(1),
});

/**
 * LAS PLANTAS PARA LAS QUE SE ESCRIBE LA PLANTILLA. Nunca vacío.
 *
 * **No es `site_id` y no contradice la cabecera de este archivo.** Una plantilla sigue
 * sin pertenecer a una planta: sigue siendo UNA, con UN juego de `item_key`, y las dos
 * plantas siguen compartiendo la identidad de cada pregunta. Esto es otra pregunta —dónde se
 * piensa USAR—, y existe porque el catálogo de ubicaciones se mapea POR PLANTA: una
 * sección solo puede nombrar una ubicación compartida que la planta donde corre la
 * inspección tenga tickeada, y sin saber para qué plantas se escribe no hay forma de
 * recortar esa oferta.
 *
 * **No viaja dentro del documento**, y por eso vive acá y no en `template-document.ts`:
 * `packages/forms` interpreta el documento dentro del service worker, sobre la misma
 * entrada en el dispositivo y en el servidor. El alcance no cambia cómo se contesta una
 * pregunta; cambia qué se le puede ofrecer al autor.
 */
const siteScopeSchema = z.array(z.uuid()).min(1);

/**
 * Un borrador en el listado: lo justo para elegir cuál abrir.
 *
 * `publishable` viaja en el listado —y no solo en el detalle— porque es la única
 * pregunta que se hace sobre un borrador sin abrirlo. `issues` no: la lista completa de
 * lo que falta solo tiene sentido al lado del documento que la produce.
 *
 * `site_ids` también viaja en el listado, por la misma razón que `publishable`: «¿esta
 * plantilla es de las dos plantas o de una?» se responde sin abrir el borrador.
 */
export const templateDraftSummarySchema = z.strictObject({
  id: z.uuid(),
  key: templateKeySchema,
  name: z.string().min(1),
  updated_at: z.string(),
  publishable: z.boolean(),
  site_ids: siteScopeSchema,

  /**
   * LA PLANTILLA QUE ESTE BORRADOR CORRIGE, o `null` si va a crear una.
   *
   * Es lo que decide qué significa publicarlo —una versión más de esa plantilla,
   * o la primera de una nueva— y no cambia nada de cómo se escribe, se guarda o se
   * descarta. Viaja en el listado porque «¿esto es una plantilla nueva o una
   * corrección?» se responde sin abrir el borrador.
   */
  template_id: z.uuid().nullable(),

  /**
   * EL NÚMERO QUE VA A TENER LA VERSIÓN QUE PUBLIQUE.
   *
   * `1` para un borrador de plantilla nueva; `max + 1` para una revisión. Existe
   * porque el diálogo que pide confirmar un punto de no retorno tiene que poder
   * nombrar el registro que está por escribir, en vez de decir siempre «version 1».
   *
   * **Es una lectura, no una reserva.** Se resuelve cuando se lee el borrador; el
   * número que queda escrito lo decide `hs_template_version_next()` bajo su lock, y
   * la respuesta de la publicación informa cuál fue.
   */
  next_version: z.int().positive(),
});

export type TemplateDraftSummary = z.infer<typeof templateDraftSummarySchema>;

/**
 * El borrador completo.
 *
 * `document` puede estar incompleto y eso es el punto: un documento que se está
 * escribiendo pasa la mayor parte de su vida sin poder publicarse, y `issues` dice qué
 * le falta en vez de impedir el guardado.
 */
export const templateDraftSchema = templateDraftSummarySchema.extend({
  document: templateDraftDocumentSchema,
  issues: z.array(draftIssueSchema),
});

export type TemplateDraft = z.infer<typeof templateDraftSchema>;

export type DraftIssueDto = z.infer<typeof draftIssueSchema>;

/**
 * Crear un borrador es elegir cómo se va a llamar, y nada más.
 *
 * **Sin `key`, y es una decisión.** La clave es un identificador técnico —lo que usan los
 * seeds, lo que va a nombrar a la plantilla publicada— y pedírsela al coordinador es pedirle
 * una decisión que no tiene forma de tomar bien. La deriva el servidor del nombre, que es lo
 * que él sí sabe. Es lo que hace que el NOMBRE sea la identidad de un borrador, y por eso el
 * nombre es único (migración 0017) y la colisión se reporta sobre el nombre.
 *
 * El documento nace vacío y por lo tanto no publicable, que es lo que corresponde.
 *
 * **Sin `site_ids`, y por el mismo motivo que sin `key`.** Un borrador nace con TODO el
 * alcance de la cuenta que lo creó, y el autor lo achica después si quiere. Pedirlo acá
 * sería pedir la decisión más difícil —«¿esta plantilla va a valer para las dos
 * plantas?»— antes de haber escrito una sola pregunta.
 */
export const createTemplateDraftSchema = z.strictObject({
  name: z.string().min(1),
});

export type CreateTemplateDraft = z.infer<typeof createTemplateDraftSchema>;

/**
 * Guardar un borrador.
 *
 * `key` NO está, y no es un olvido: se deriva del nombre al crear y después es write-once
 * (`0016` §4 no la incluye en el GRANT UPDATE). Renombrar un borrador NO la mueve, así que
 * uno renombrado puede quedar con una clave que ya no se le parece — deliberado, porque un
 * identificador que cambia con cada corrección de estilo no identifica nada. Por eso el
 * editor la muestra de solo lectura en vez de esconderla del todo.
 *
 * `site_ids` SÍ está, y viaja en el mismo guardado que el documento a propósito: cambiar
 * el alcance es una edición como cualquier otra y el autor la confirma con un solo botón.
 * Un endpoint aparte dividiría una edición en dos escrituras que podrían intercalarse.
 */
export const saveTemplateDraftSchema = z.strictObject({
  name: z.string().min(1),
  document: templateDraftDocumentSchema,
  site_ids: siteScopeSchema,
});

export type SaveTemplateDraft = z.infer<typeof saveTemplateDraftSchema>;
