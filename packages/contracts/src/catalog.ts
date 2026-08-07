import { z } from 'zod';

/**
 * Requisitos §6 pregunta cerrada 1 — El catálogo de sitios y ubicaciones.
 *
 * "La ubicación del hallazgo es una lista cerrada administrada por el
 * coordinador, no texto libre." Este archivo es la mitad que ve el cliente: la
 * forma de una entrada del catálogo y la forma de las dos únicas operaciones que
 * el coordinador puede hacer sobre ella.
 *
 * Lo que este esquema NO puede validar es todo lo que depende del estado de la
 * base: que la ubicación exista, que sea del sitio de quien la referencia, que su
 * nombre no choque con otra activa. Eso son claves foráneas, únicos y triggers en
 * `apps/api/drizzle/0004_site_location_catalog.sql`. Zod valida la forma; el
 * motor valida las referencias.
 *
 * **No hay, y no puede haber, un campo de texto libre de ubicación.** Si lo
 * hubiera, la lista dejaría de ser cerrada por la puerta de atrás y la agrupación
 * fina de la recurrencia (§5 riesgo A) volvería a ser imposible. Lo que se
 * referencia es un `location_id`.
 */

/**
 * `code` legible y no opaco: los seeds se escriben a mano y el code aparece en
 * los reportes. Minúsculas, dígitos, y `.` o `-` como separadores entre
 * segmentos — nunca al principio ni al final.
 *
 * El mismo patrón está escrito como `CHECK` en la migración 0004. Si uno cambia,
 * el otro también.
 */
export const CATALOG_CODE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const codeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(CATALOG_CODE_PATTERN, 'code: minúsculas, dígitos y "." o "-" como separadores');

const labelSchema = z.string().trim().min(1).max(120);

/** Una de las dos plantas. */
export const siteSchema = z.strictObject({
  id: z.uuid(),
  code: codeSchema,
  name: labelSchema,
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type Site = z.infer<typeof siteSchema>;

/** Una entrada del catálogo, tal como la devuelve la API. */
export const locationSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  code: codeSchema,
  name: labelSchema,
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type Location = z.infer<typeof locationSchema>;

/**
 * Lo que necesita el desplegable, y nada más. Solo se arman con las activas: una
 * ubicación desactivada sigue resolviendo desde el historial, pero no se ofrece.
 */
export const locationOptionSchema = locationSchema.pick({ id: true, code: true, name: true });

export type LocationOption = z.infer<typeof locationOptionSchema>;

/**
 * La referencia a una ubicación desde cualquier registro que la lleve. Es un id,
 * nunca un texto: es lo que hace que la lista sea cerrada del lado del contrato,
 * y la FK compuesta `(site_id, location_id)` lo hace del lado del motor.
 */
export const locationReferenceSchema = z.strictObject({
  location_id: z.uuid(),
});

export type LocationReference = z.infer<typeof locationReferenceSchema>;

/** Alta de una ubicación. El sitio sale del alcance de la sesión, no del payload. */
export const createLocationSchema = z.strictObject({
  code: codeSchema,
  name: labelSchema,
});

export type CreateLocation = z.infer<typeof createLocationSchema>;

/**
 * Las dos únicas cosas que se pueden cambiar de una ubicación: cómo se llama y si
 * sigue ofreciéndose. `code` y `site_id` no están, y no es una omisión — el
 * trigger `location_guard` rechaza cambiarlos venga de donde venga.
 */
export const updateLocationSchema = z
  .strictObject({
    name: labelSchema.optional(),
    deactivated: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.deactivated !== undefined,
    'un update tiene que cambiar el nombre, el estado, o los dos',
  );

export type UpdateLocation = z.infer<typeof updateLocationSchema>;
