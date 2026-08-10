/**
 * El prefijo del bucket para la evidencia de una acción correctiva (design D9).
 *
 * `{site_id}/actions/{action_id}/{uuid}`. La más simple de las tres formas del
 * sistema: a diferencia del hallazgo manual, cuando se sube evidencia **la acción ya
 * existe**, así que no hace falta ningún `draft_*_id` que el cliente genere para
 * agrupar archivos de algo que todavía no está en la base.
 *
 * `actions/` como segmento fijo, por lo mismo que `manual/` en `findings/object-key.ts`:
 * sin él, un uuid en la segunda posición sería indistinguible del de una inspección
 * programada, y las tres verificaciones de prefijo dejarían de ser tres afirmaciones
 * separadas.
 */
export function actionObjectKeyPrefix(siteId: string, actionId: string): string {
  return `${siteId}/actions/${actionId}/`;
}

/**
 * Las keys que NO pertenecen a esta acción. Vacío significa que todas pertenecen.
 *
 * Es el tercer gemelo de `foreignObjectKeys` de `inspections/submission.ts` y de
 * `foreignManualKeys` de `findings/object-key.ts`, y **no los reusa**: son tres
 * afirmaciones distintas sobre tres prefijos distintos, y compartir la función haría
 * que el día que una cambie mal, cambien las tres juntas y ningún test lo note.
 */
export function foreignEvidenceKeys(
  keys: readonly string[],
  siteId: string,
  actionId: string,
): string[] {
  const prefix = actionObjectKeyPrefix(siteId, actionId);

  return keys.filter((key) => !key.startsWith(prefix));
}
