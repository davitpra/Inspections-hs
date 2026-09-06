import type { DraftStatus } from '../offline/db';
import { DiscardRefusedError, type DiscardRefusal } from '../offline/drafts';
import { formatCivilDay } from './dates';

/**
 * Cómo se nombra en pantalla el borrador que vive EN ESTE DISPOSITIVO.
 *
 * Lo leen las dos pantallas del recorrido —la captura y la revisión— y por eso vive acá y
 * no en la carpeta de una de ellas: el encabezado tiene que decir lo mismo antes y después
 * de terminar de contestar. Si el estado se llamara «Draft» en una pantalla y «In progress»
 * en la otra, el inspector leería dos cosas distintas del mismo borrador.
 *
 * No confundir con `presentation/templates.ts`, que también habla de borradores: aquéllos
 * son borradores de PLANTILLA en la consola del coordinador, y su estado es si se pueden
 * publicar. Éstos son el trabajo sin enviar de un inspector.
 */

/** El estado del borrador tal como se lee en la píldora del encabezado. */
export function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'capturing':
      return 'Draft';
    case 'signed':
      return 'Signed';
    case 'accepted':
      return 'Accepted';
  }
}

/**
 * La clase de la píldora. Los tres modificadores ya existen en `index.css` y se eligen por
 * lo que significan, no por el color: `--draft` es trabajo en curso, `--signed` es lo que
 * espera salir del dispositivo (ámbar: todavía no llegó), `--completed` es lo cerrado.
 */
export function draftStatusPill(status: DraftStatus): string {
  switch (status) {
    case 'capturing':
      return 'status-pill status-pill--draft';
    case 'signed':
      return 'status-pill status-pill--signed';
    case 'accepted':
      return 'status-pill status-pill--completed';
  }
}

/**
 * La línea bajo el título: contra QUÉ se abrió este borrador y desde cuándo.
 *
 * Dice el nombre de la plantilla y no el número de versión. La versión es lo que el envío
 * lleva adentro, pero no le dice nada al inspector parado en la planta; lo que necesita
 * leer es qué formulario está recorriendo. El nombre lo trae el paquete descargado
 * (`template_name`), así que esto se resuelve sin red como todo lo demás en estas pantallas
 * (ADR-001).
 *
 * `templateName` puede faltar, y no es un caso hipotético: un dispositivo que bajó el
 * paquete ANTES de que el campo existiera tiene una fila de `prefetch` sin él —el parseo
 * corre al descargar, no al leer— y seguirá así hasta que se vuelva a bajar. Entonces
 * queda solo la fecha, nunca un `undefined` en pantalla.
 *
 * La fecha es la de CREACIÓN del borrador, la misma que cuenta la edad del trabajo sin
 * enviar en `offline/unsynced.ts`: "desde cuándo vengo con esto encima".
 */
export function draftSubtitle(templateName: string | undefined, createdAt: string): string {
  const started = `Started ${formatCivilDay(createdAt)}`;

  return templateName ? `${templateName} • ${started}` : started;
}

/**
 * Por qué la base se negó a descartar, en el idioma del inspector.
 *
 * Acompaña a `DiscardDraftDialog`, que lo montan dos rutas, y por eso vive acá: el motivo
 * es del borrador, no de la pantalla desde la que se lo intentó descartar.
 *
 * `already_signed` y `already_queued` dicen lo mismo a propósito. Son dos comprobaciones
 * distintas —la columna `status` y la existencia de la fila de cola— porque una puede
 * estar desincronizada de la otra, pero para el inspector la conclusión es una sola: eso
 * ya salió de sus manos (ADR-001, el envío es el punto de no retorno).
 */
export function discardRefusalMessage(error: unknown): string {
  const reason: DiscardRefusal | 'unknown' =
    error instanceof DiscardRefusedError ? error.reason : 'unknown';

  switch (reason) {
    case 'not_owner':
      return 'This draft belongs to another account on this device. Sign in as its owner to discard it.';
    case 'already_signed':
    case 'already_queued':
      return 'This inspection is signed and waiting to be sent. It cannot be discarded — it is on its way.';
    default:
      return 'The draft could not be discarded. It is still on this device.';
  }
}
