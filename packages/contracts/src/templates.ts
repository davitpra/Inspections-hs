import { z } from 'zod';

import { SECTION_KEY_PATTERN, templateDraftDocumentSchema } from './template-document.js';

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
 * Lo que sigue fuera es la **publicación**. Un borrador no escribe una sola fila en
 * `template`, `template_item` ni `template_version`, y por eso un borrador nunca aparece
 * en `templateOptionSchema`: son dos poblaciones que no se tocan hasta que alguien
 * publique.
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
 */
export const templateOptionSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  latest_version: z.int().positive(),
  latest_version_id: z.uuid(),
});

export type TemplateOption = z.infer<typeof templateOptionSchema>;

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
 * Un borrador en el listado: lo justo para elegir cuál abrir.
 *
 * `publishable` viaja en el listado —y no solo en el detalle— porque es la única
 * pregunta que se hace sobre un borrador sin abrirlo. `issues` no: la lista completa de
 * lo que falta solo tiene sentido al lado del documento que la produce.
 */
export const templateDraftSummarySchema = z.strictObject({
  id: z.uuid(),
  key: templateKeySchema,
  name: z.string().min(1),
  revision: z.int().positive(),
  updated_at: z.string(),
  publishable: z.boolean(),
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
 */
export const createTemplateDraftSchema = z.strictObject({
  name: z.string().min(1),
});

export type CreateTemplateDraft = z.infer<typeof createTemplateDraftSchema>;

/**
 * Guardar un borrador.
 *
 * `revision` es el lock: el cliente declara sobre qué revisión editó y el servidor
 * rechaza si ya no es esa. Sin él, dos pestañas del mismo autor —el caso normal, no el
 * raro— hacen que la segunda pise a la primera sin que nadie se entere.
 *
 * `key` NO está, y no es un olvido: se deriva del nombre al crear y después es write-once
 * (`0016` §4 no la incluye en el GRANT UPDATE). Renombrar un borrador NO la mueve, así que
 * uno renombrado puede quedar con una clave que ya no se le parece — deliberado, porque un
 * identificador que cambia con cada corrección de estilo no identifica nada. Por eso el
 * editor la muestra de solo lectura en vez de esconderla del todo.
 */
export const saveTemplateDraftSchema = z.strictObject({
  name: z.string().min(1),
  document: templateDraftDocumentSchema,
  revision: z.int().positive(),
});

export type SaveTemplateDraft = z.infer<typeof saveTemplateDraftSchema>;
