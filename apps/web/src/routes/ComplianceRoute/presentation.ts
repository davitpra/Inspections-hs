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

/** `2026-04-01` → `2026-04`. La grilla es de meses, no de días. */
export function monthLabel(periodStart: string): string {
  return periodStart.slice(0, 7);
}

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
