/**
 * Motor de formularios compartido entre `apps/web` y `apps/api` (ADR-007).
 *
 * Este paquete viaja dentro del bundle del service worker: no puede importar
 * builtins de Node ni librerías que asuman servidor. La regla se aplica por lint
 * (bloque `packages/forms` en `eslint.config.js`), no por disciplina. `zod` es
 * la única dependencia y es isomórfica.
 *
 * El paquete es dueño del documento de `template_version`: el mismo esquema que
 * el dispositivo usa para renderizar sin red es el que el servidor usa para
 * re-validar el envío. `@hs/contracts` lo re-exporta.
 */

export * from './document/answers.js';
export * from './document/conditions.js';
export * from './document/draft.js';
export * from './document/negative.js';
export * from './document/progress.js';
export * from './document/schema.js';
export * from './document/validate.js';
export * from './document/visibility.js';

/**
 * Una respuesta se considera sin contestar cuando está vacía. `false` y `0` son
 * respuestas válidas: la distinción importa porque un ítem de cumplimiento en
 * `false` es exactamente el que deriva un hallazgo.
 */
export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
