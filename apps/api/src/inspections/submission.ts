import type { InspectionSubmission } from '@hs/contracts';
// El motor se importa de `@hs/forms` y no de `@hs/contracts`: contracts re-exporta la
// FORMA del documento, no el motor. Lo dice el comentario de `template-document.ts`.
import { signatureAnswerSchema } from '@hs/forms';

/**
 * Las dos operaciones del envío que no necesitan base ni red (ADR-008, "capas dentro
 * del módulo": funciones puras de dominio donde hay reglas reales).
 *
 * 1. Fundir las object keys de las fotos dentro del conjunto de respuestas, porque el
 *    dispositivo las manda por separado y el motor de formularios espera una sola cosa.
 * 2. Verificar que toda object key referenciada pertenezca a ESTA inspección.
 *
 * La segunda es una barrera de seguridad, no una validación de forma: sin ella, un
 * dispositivo comprometido puede hacer que el registro legal de una inspección apunte
 * a las fotos de otra planta. Vive acá, sin base, para poder tener una tabla de casos
 * que corra en milisegundos.
 */

/**
 * Por qué `photos` viaja aparte de `answers` y hay que fundirlos.
 *
 * El dispositivo guarda las fotos en su propia tabla de Dexie —blob primero, object
 * key cuando la subida termina— y `toAnswerSet` de `apps/web/src/offline/drafts.ts`
 * solo recorre la tabla de respuestas. Un ítem de tipo `photo` llega entonces SIN
 * entrada en `answers` y con sus keys en `photos`.
 *
 * `validateAnswers` no sabe nada de eso: para el motor, la respuesta de un ítem
 * `photo` es un `string[]` de object keys. Si no se fundieran, todo ítem de foto
 * obligatorio saldría `required_missing` y ningún envío con fotos se aceptaría jamás.
 */
export type MergeResult =
  | { readonly ok: true; readonly answers: Record<string, unknown> }
  /** La misma `item_key` en los dos mapas: un dispositivo con un bug, no un caso. */
  | { readonly ok: false; readonly collisions: readonly string[] };

export function mergePhotoAnswers(
  answers: InspectionSubmission['answers'],
  photos: InspectionSubmission['photos'],
): MergeResult {
  const collisions = Object.keys(photos).filter((itemKey) => itemKey in answers);

  // No gana ninguno de los dos: se rechaza. Dos fuentes para la misma respuesta es
  // una ambigüedad sobre qué quedó registrado, y esta tabla es inmutable — elegir en
  // silencio deja la duda escrita para siempre.
  if (collisions.length > 0) return { ok: false, collisions };

  return { ok: true, answers: { ...answers, ...photos } };
}

/**
 * Toda object key que el envío referencia, mirada donde puede haberlas: las listas de
 * `photos`, las fotos del bloque `findings` y el `object_key` de una firma.
 *
 * Se recorre `answers` con el esquema de la firma y no con el `response_type` del
 * ítem: esto corre ANTES de validar contra el documento, que es donde tiene que
 * correr — comprobar el prefijo después de aceptar la forma sería aceptar primero y
 * preguntar después.
 *
 * `findings` entró acá el mismo día que entró al payload, y tenía que entrar: una
 * lista de keys que el dispositivo escribe y que nadie verifica es exactamente el
 * agujero por el que el registro legal de una inspección termina apuntando a las
 * fotos de la otra planta.
 */
export function objectKeysOf(
  answers: InspectionSubmission['answers'],
  photos: InspectionSubmission['photos'],
  // Sin valor por defecto a propósito: un parámetro opcional dejaría que un caller
  // futuro se olvide del bloque y la verificación de prefijo pase sin mirarlo.
  findings: InspectionSubmission['findings'],
): string[] {
  const keys: string[] = [];

  for (const list of Object.values(photos)) keys.push(...list);

  for (const details of Object.values(findings)) keys.push(...details.photo_object_keys);

  for (const value of Object.values(answers)) {
    const signature = signatureAnswerSchema.safeParse(value);

    if (signature.success) keys.push(signature.data.object_key);
  }

  return keys;
}

/**
 * El prefijo que `deriveObjectKey` de `uploads/object-storage.ts` produce:
 * `{site_id}/{scheduled_inspection_id}/`.
 *
 * Se escribe acá otra vez —en vez de exportarlo desde `uploads`— porque son dos
 * afirmaciones distintas que tienen que coincidir: una dice dónde se escribe, la otra
 * qué se acepta. Un test compara las dos; si se compartiera la constante, el día que
 * el prefijo cambie mal las dos cambiarían juntas y el test no diría nada.
 */
export function objectKeyPrefix(siteId: string, scheduledInspectionId: string): string {
  return `${siteId}/${scheduledInspectionId}/`;
}

/**
 * Las keys que NO pertenecen a esta inspección. Vacío significa que todas pertenecen.
 *
 * `uploads` deriva la key y nunca deja que el dispositivo la elija, así que en el
 * camino honesto esto no rechaza nada. Existe para el camino deshonesto: el payload
 * del envío sí lo escribe el dispositivo, y una key es una cadena que puede decir
 * cualquier cosa.
 */
export function foreignObjectKeys(
  keys: readonly string[],
  siteId: string,
  scheduledInspectionId: string,
): string[] {
  const prefix = objectKeyPrefix(siteId, scheduledInspectionId);

  return keys.filter((key) => !key.startsWith(prefix));
}
