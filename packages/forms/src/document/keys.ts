/**
 * `item_key` legible y no opaca: los seeds se escriben a mano y la key aparece
 * en el reporte de recurrencia que lee el coordinador. Minúsculas, dígitos, y
 * `.` o `-` como separadores entre segmentos — nunca al principio ni al final.
 *
 * El mismo patrón está escrito como `CHECK` en la migración 0003. Si uno cambia,
 * el otro también.
 *
 * Vive en su propio módulo porque lo usan tanto el esquema del documento como el
 * de las condiciones, y el documento importa las condiciones: sin esto habría un
 * ciclo entre los dos archivos.
 */
export const ITEM_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Mismo formato que `item_key`, por las mismas razones. */
export const SECTION_KEY_PATTERN = ITEM_KEY_PATTERN;
