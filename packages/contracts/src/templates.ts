import { z } from 'zod';

/**
 * Requisitos §7 — Las plantillas, tal como se ELIGEN. No como se editan.
 *
 * Este archivo es un DTO de listado y nada más: lo que hace falta para que el
 * coordinador elija una plantilla al crear una regla de recurrencia. La edición y la
 * publicación son la etapa 8 —el builder visual— y siguen fuera del recorrido crítico;
 * hasta entonces las plantillas se cargan como seeds en SQL.
 *
 * **Por qué no vive en `template-document.ts`**: ese archivo tiene la forma del
 * documento congelado, la que interpreta `packages/forms` dentro del service worker. Un
 * DTO de pantalla ahí lo arrastraría a un lugar donde no pinta nada.
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
