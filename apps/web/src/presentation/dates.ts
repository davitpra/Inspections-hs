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
