/**
 * El prefijo del bucket para las fotos de un hallazgo de entrada manual (design D9).
 *
 * Un hallazgo manual no cuelga de ninguna inspección programada, así que no puede usar
 * el prefijo de `uploads/object-storage.ts`. Usa el suyo: `{site_id}/manual/
 * {draft_finding_id}/{uuid}`, donde `draft_finding_id` lo genera el cliente antes de
 * subir la primera foto —igual que `client_submission_id`— y es lo único que agrupa las
 * fotos de un hallazgo que todavía no existe.
 *
 * `manual/` como segmento fijo, y no el `draft_finding_id` suelto: sin él, un uuid en
 * la segunda posición sería indistinguible del de una inspección programada, y la
 * verificación de prefijo de un envío y la de un hallazgo manual dejarían de ser dos
 * afirmaciones separadas.
 */
export function manualObjectKeyPrefix(siteId: string, draftFindingId: string): string {
  return `${siteId}/manual/${draftFindingId}/`;
}

/**
 * Las keys que NO pertenecen a este hallazgo manual. Vacío significa que todas
 * pertenecen.
 *
 * Es el gemelo de `foreignObjectKeys` de `inspections/submission.ts` y no lo reusa:
 * son dos afirmaciones distintas sobre dos prefijos distintos, y compartir la función
 * haría que el día que uno cambie mal, los dos cambien juntos y ningún test lo note.
 */
export function foreignManualKeys(
  keys: readonly string[],
  siteId: string,
  draftFindingId: string,
): string[] {
  const prefix = manualObjectKeyPrefix(siteId, draftFindingId);

  return keys.filter((key) => !key.startsWith(prefix));
}
