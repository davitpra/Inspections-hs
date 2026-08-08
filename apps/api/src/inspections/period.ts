/**
 * El período de una inspección es una FECHA CIVIL, no un instante.
 *
 * Sin esto, un cron a las 03:00 de Ontario el 1 de septiembre —que en UTC es el 1 a
 * las 07:00— está bien, pero uno a medianoche UTC abre el período de septiembre el 31
 * de agosto a las 20:00 hora local. La planta no trabaja en UTC y el registro
 * regulatorio tampoco: "la inspección de agosto" es agosto en Ontario.
 *
 * Se resuelve con `Intl` y no con aritmética de offsets porque el horario de verano
 * mueve el offset dos veces al año; `Intl` conoce la regla y una resta de horas no.
 */

/** La fecha civil de una zona, como `YYYY-MM-DD`. */
export function civilDate(instant: Date, timeZone: string): string {
  // `en-CA` produce `YYYY-MM-DD`, que es el formato que la base espera y el orden
  // lexicográfico que hace comparable una fecha como texto.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** El primer día del mes en curso en esa zona, como `YYYY-MM-DD`. */
export function currentPeriodStart(instant: Date, timeZone: string): string {
  return `${civilDate(instant, timeZone).slice(0, 7)}-01`;
}
