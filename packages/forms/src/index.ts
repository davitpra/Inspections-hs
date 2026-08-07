/**
 * Motor de formularios compartido entre `apps/web` y `apps/api` (ADR-007).
 *
 * Este paquete viaja dentro del bundle del service worker: no puede importar
 * builtins de Node ni librerías que asuman servidor. La regla se aplica por lint
 * (bloque `packages/forms` en `eslint.config.js`), no por disciplina.
 *
 * Etapa 0: solo el esqueleto. Los tipos de ítem, la lógica condicional y la
 * validación contra una `template_version` llegan en la etapa 3.
 */

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
