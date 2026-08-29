/**
 * Cómo se nombra un hallazgo en pantalla.
 *
 * Las dos pantallas que los dibujan —el reporte completo y la lectura de solo hallazgos—
 * los cuentan igual. Es la única razón por la que esto no vive en la carpeta de una ruta.
 */

/**
 * Cuántas fotos acompañan a un hallazgo, dicho como se lee en pantalla.
 *
 * `No photos` y no un hueco: las fotos todavía no se pueden mirar, así que el conteo ES la
 * declaración de la evidencia. Callar el cero haría que un hallazgo sin fotos se leyera
 * igual que uno cuyas fotos la pantalla no supo contar.
 */
export function photoCountText(count: number): string {
  if (count === 0) return 'No photos';

  return count === 1 ? '1 photo' : `${count} photos`;
}

/** Cuántos hallazgos abrió una sección. Plural correcto, por lo mismo que `answersLabel`. */
export function findingsLabel(count: number): string {
  return count === 1 ? '1 finding' : `${count} findings`;
}
