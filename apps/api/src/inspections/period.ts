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

/**
 * El inicio del período que CONTIENE a `month`, para una regla de esa frecuencia y ancla.
 *
 * LA PREGUNTA NO ES "¿este mes empieza período?" SINO "¿de qué período es este mes?", y la
 * diferencia es la propiedad de recuperación de ADR-005. El cron es diario justamente
 * para que un día 1 con el servidor caído no pierda el período: si el `INSERT` filtrara
 * por «hoy es un mes ancla», un trimestre cuyo primer mes se perdió no se abriría nunca y
 * nadie se enteraría hasta que alguien preguntara por qué no hay inspección del Q2.
 * Preguntando por el período que contiene al mes, las noventa corridas del trimestre
 * calculan el MISMO `period_start` y el único parcial absorbe las ochenta y nueve
 * sobrantes.
 *
 * La aritmética es `mod` sobre el mes 1-12 y no sobre un índice absoluto de meses, y por
 * eso `frequencyMonths` tiene que dividir a 12 —los cuatro valores que el CHECK de 0029
 * admite—: con eso el ancla no depende del año, y `(mes - ancla + 12) mod n` da los meses
 * que hay que retroceder sin importar si el período empezó en diciembre pasado.
 *
 * ESPEJO EXACTO de la expresión SQL de `open-period.service.ts` y de `ruleOwesPeriod()` en
 * el cliente. Las tres tienen que decir lo mismo; los tests de las dos de TypeScript fijan
 * los mismos casos a propósito.
 *
 * `month` es `YYYY-MM-01`.
 */
export function containingPeriodStart(
  month: string,
  frequencyMonths: number,
  anchorMonth: number,
): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));

  const back = (monthNumber - anchorMonth + 12) % frequencyMonths;

  // El `- 1` y el `+ 1` convierten entre el mes 1-12 y el índice 0-11 que la división
  // entera necesita para cruzar el año hacia atrás sin un caso especial para enero.
  const index = year * 12 + (monthNumber - 1) - back;

  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Si `month` (`YYYY-MM-01`) es el primer mes de un período de esa regla. */
export function startsPeriod(
  month: string,
  frequencyMonths: number,
  anchorMonth: number,
): boolean {
  return (Number(month.slice(5, 7)) - anchorMonth + 12) % frequencyMonths === 0;
}
