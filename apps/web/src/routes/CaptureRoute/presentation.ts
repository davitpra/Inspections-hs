import type { DraftStatus } from '../../offline/db';
import { formatCivilDay } from '../../presentation/dates';

/**
 * Lo que la pantalla de captura DICE, separado de lo que decide.
 *
 * Nada de acá lee el reloj ni la red: son funciones de una entrada a una cadena, y por eso
 * se prueban sin renderizar. Quién es una respuesta negativa, cuántas están contestadas y
 * qué ítem se ve lo sigue diciendo `@hs/forms` — este archivo solo les pone nombre.
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
 * (`template_name`), así que esto se resuelve sin red como todo lo demás en esta pantalla
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
export function captureSubtitle(templateName: string | undefined, createdAt: string): string {
  const started = `Started ${formatCivilDay(createdAt)}`;

  return templateName ? `${templateName} • ${started}` : started;
}

/** El chip de la cabecera de sección. El número lo cuenta el motor, no esta función. */
export function answeredLabel(answered: number): string {
  return `${answered} answered`;
}
