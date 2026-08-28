/**
 * Lo que la pantalla de captura DICE, separado de lo que decide.
 *
 * Nada de acá lee el reloj ni la red: son funciones de una entrada a una cadena, y por eso
 * se prueban sin renderizar. Quién es una respuesta negativa, cuántas están contestadas y
 * qué ítem se ve lo sigue diciendo `@hs/forms` — este archivo solo les pone nombre.
 *
 * El estado del borrador y la línea del encabezado NO están acá: los lee también la
 * revisión, así que viven en `presentation/drafts.ts`. Lo que queda es lo que solo esta
 * pantalla dibuja.
 */

/** El chip de la cabecera de sección. El número lo cuenta el motor, no esta función. */
export function answeredLabel(answered: number): string {
  return `${answered} answered`;
}
