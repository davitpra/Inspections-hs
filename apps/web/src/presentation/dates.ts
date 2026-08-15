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
