import type { PeriodStatus } from '@hs/contracts';

/**
 * Las etiquetas y el rango del año, aparte del componente.
 *
 * `open` dice "todavía abierto" y no "pendiente": lo que no terminó no se cuenta como
 * omitido, y la etiqueta tiene que decir eso mismo que dice el conteo.
 */
export const STATUS_LABELS: Readonly<Record<PeriodStatus, string>> = {
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
  open: 'Still open',
};

export function yearOf(year: number): { rangeStart: string; rangeEnd: string } {
  return { rangeStart: `${year}-01-01`, rangeEnd: `${year}-12-31` };
}

/**
 * El año en curso y los cuatro anteriores: el sistema no tiene datos más viejos.
 *
 * Recibe el año en vez de leer el reloj para que se pueda comprobar; quien llama es el
 * componente, que sí puede mirar la fecha.
 */
export function yearChoices(currentYear: number): number[] {
  return [0, 1, 2, 3, 4].map((offset) => currentYear - offset);
}
