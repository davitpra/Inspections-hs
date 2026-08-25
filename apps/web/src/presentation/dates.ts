/**
 * Las dos formas de leer un instante en la interfaz.
 *
 * Son dos y no una: un plazo de acción correctiva se lee por día —la hora no cambia
 * nada de lo que hay que hacer— y un reloj regulatorio de 48 horas no, porque ahí la
 * hora ES el plazo.
 *
 * Recortan la cadena ISO en vez de formatear con `Intl`, y eso es deliberado: el
 * servidor manda UTC, y una fecha local haría que un envío de las 23:00 apareciera con
 * el día siguiente en una pantalla y con el anterior en otra. Un registro que se defiende
 * ante un regulador se lee en el mismo huso en que se guardó.
 */

/** La fecha sin hora: un plazo se lee por día, y las listas también. */
export function formatDay(value: string): string {
  return value.slice(0, 10);
}

/** Fecha y hora: a diferencia de un plazo de acción, 48 horas se leen con la hora. */
export function formatInstant(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

/*
 * El mes de un período y el año civil de la planta.
 *
 * Viven acá y no en una ruta porque son de las dos que hojean un calendario —la consola
 * de programación y la lista de pendientes del inspector— y el mes tiene que leerse igual
 * en las dos o deja de ser el mismo mes.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** El mes del período, sin el año — el año lo da el encabezado del grupo. `2026-08-01` → `August`. */
export function monthName(periodStart: string): string {
  // `period_start` siempre cae en el primero de un mes válido (periodStartSchema lo exige).
  return MONTH_NAMES[Number(periodStart.slice(5, 7)) - 1]!;
}

/**
 * EL NOMBRE COMPLETO DE UN PERÍODO: `August 2026`, `Q1 2026`, `H2 2026`, `2026`.
 *
 * **Se reexporta de `@hs/contracts` y no se implementa acá**, a diferencia de `monthName`
 * y de `civilDate`, que sí son copias deliberadas. La diferencia es quién más lo usa: la
 * zona horaria la repite el cliente porque no puede importar de `apps/api`, pero esta
 * etiqueta la usan varias pantallas operativas, y `contracts` es el único lugar compartido.
 * Dos implementaciones serían dos formas de nombrar el mismo trimestre.
 *
 * Se reexporta desde acá igual, y no se importa de `@hs/contracts` en cada componente,
 * para que el lugar donde se busca «cómo se lee una fecha» siga siendo uno solo.
 */
export { periodLabel } from '@hs/contracts';

/**
 * La zona de la planta. La misma que resuelve el trabajo automático
 * (`apps/api/src/jobs/job-registry.ts` `SITE_TIME_ZONE`) — el cliente no puede importar
 * ese archivo, así que el valor se repite acá, y por eso el borde de horario de verano
 * está fijado en un test en los dos lados.
 */
const SITE_TIME_ZONE = 'America/Toronto';

/**
 * La fecha civil de la planta, como `YYYY-MM-DD`. Espejo de `civilDate` en
 * `apps/api/src/inspections/period.ts`: mismo método (`Intl`, no aritmética de offsets),
 * por la misma razón — el horario de verano mueve el offset dos veces al año.
 */
function civilDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** El mes civil de un instante, como `YYYY-MM`. */
export function civilMonth(instant: Date, timeZone: string = SITE_TIME_ZONE): string {
  return civilDate(instant, timeZone).slice(0, 7);
}

/** El año civil de hoy, en la zona de la planta. Punto de partida de la navegación. */
export function currentCivilYear(now: Date = new Date()): string {
  return civilMonth(now).slice(0, 4);
}

/** El día civil de hoy, como `YYYY-MM-DD`. Lo que `dueIn` compara contra un plazo. */
export function civilToday(now: Date = new Date(), timeZone: string = SITE_TIME_ZONE): string {
  return civilDate(now, timeZone);
}

/**
 * El día de un instante, escrito para leerse en una celda: `2027-07-29T…` → `Jul 29, 2027`.
 *
 * A diferencia de `formatDay`, que recorta la cadena, este RESUELVE el día en la zona de la
 * planta, y tiene que hacerlo: `completed_at` es un instante y no un día, así que un envío
 * firmado a las 21:00 de Ontario llega como el día siguiente en UTC. Recortarlo lo fecharía
 * un día tarde — y en el último día de un mes, un mes tarde, que es justamente lo que
 * identifica la obligación ante el regulador.
 *
 * El mes se escribe con `MONTH_NAMES` y no con el formato largo de `Intl`: la zona es lo
 * único que se delega, nunca el idioma. La interfaz es solo inglés y no depende del locale
 * del dispositivo.
 */
export function formatCivilDay(instant: string, timeZone: string = SITE_TIME_ZONE): string {
  const day = civilDate(new Date(instant), timeZone);

  return `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]!.slice(0, 3)} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`;
}
