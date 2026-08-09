import { templateDocumentSchema } from '@hs/forms';
import { z } from 'zod';

import { locationOptionSchema } from './catalog.js';
import { personOptionSchema } from './identity.js';

/**
 * El paquete de campo: lo que una inspección programada necesita para poder trabajarse
 * sin señal.
 *
 * Son TRES lecturas y no una, y esa separación es el requisito: un dispositivo que
 * obtiene dos de las tres tiene que poder nombrar cuál le falta. Una respuesta única
 * solo permitiría fallar entera.
 *
 * Las tres cuelgan de la inspección y no del recurso —no hay `GET /locations`— porque el
 * alcance es una sola pregunta, resuelta por RLS sobre `scheduled_inspection`, y porque
 * lo que el dispositivo pide no es el catálogo sino lo que ESTA inspección necesita.
 *
 * Este archivo es el contrato compartido: `apps/api` lo usa para responder y `apps/web`
 * para parsear. Que sea uno solo es lo que convierte un desajuste en un error de
 * compilación en vez de un `safeParse` que falla en una planta.
 */

/**
 * La versión de plantilla contra la que se va a capturar.
 *
 * **`version` y `template_version_id` son los de la inspección, congelados al
 * programar.** El servidor no resuelve "la más alta publicada" al leer: publicar la v3
 * no mueve una inspección atada a la v2, y esta respuesta es donde esa garantía se
 * verifica o se pierde.
 *
 * `site_id` viaja acá porque es la primera de las tres lecturas y porque el dispositivo
 * necesita saber de qué planta es la inspección **sin red**: es lo que marca al dueño
 * del borrador. Es un dato de la inspección, no de la versión.
 */
export const templateVersionPackageSchema = z.strictObject({
  site_id: z.uuid(),
  template_version_id: z.uuid(),
  version: z.int().positive(),
  document: templateDocumentSchema,
});

export type TemplateVersionPackage = z.infer<typeof templateVersionPackageSchema>;

/**
 * El catálogo cerrado de ubicaciones de la planta de la inspección, solo las activas.
 *
 * Reusa `locationOptionSchema` tal cual. Si hubiera hecho falta una forma nueva de
 * ubicación para esta ruta, sería señal de que la ruta está devolviendo algo que no es
 * una opción de desplegable.
 */
export const locationPackageSchema = z.array(locationOptionSchema);

export type LocationPackage = z.infer<typeof locationPackageSchema>;

/**
 * El subconjunto activo del roster de esa misma planta.
 *
 * `personOptionSchema` es `strictObject` y eso es lo que importa acá: §4 dice que el
 * operador elige a una persona **sin poder ver su perfil**, así que un campo de más en
 * esta respuesta no es un extra, es una filtración. El contrato lo rechaza.
 */
export const rosterPackageSchema = z.array(personOptionSchema);

export type RosterPackage = z.infer<typeof rosterPackageSchema>;
