import type { PoolClient } from 'pg';

import type { DbService } from '../db/db.service';

/**
 * Administrar una cuenta es escribir en la cadena de auditoría de cada planta que esa
 * cuenta alcanza, y `hs_account_audit_fanout()` (0005 §8) rechaza con `HS002` toda
 * planta que no esté declarada en el alcance de la transacción.
 *
 * Entonces toda escritura de este módulo que dispare esos triggers —invitación,
 * credencial, segundo factor— tiene que correr con un alcance declarado. Este helper
 * es el único lugar donde se declara, para que no haya una segunda forma de hacerlo.
 *
 * SE DECLARA EL ALCANCE DEL ACTOR, no el de la cuenta administrada, y esa elección es
 * la que convierte `HS002` en una regla de permisos gratis: si el coordinador
 * administra a alguien que alcanza una planta que él no tiene, el motor lo frena. No
 * hace falta ninguna verificación en el servicio, y no hay forma de olvidarse de
 * escribirla.
 *
 * `app.user_id` va con el actor porque es lo que le pone nombre a la entrada: sin él,
 * "alguien le dio acceso a esta persona" queda sin sujeto, que es exactamente lo que
 * ADR-011 no quiere.
 */
export async function asAdministrator<T>(
  db: DbService,
  actorUserId: string,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { rows } = await db.unscopedPool.query<{ site_ids: string[] }>(
    `SELECT coalesce(array_agg(site_id ORDER BY site_id), ARRAY[]::uuid[]) AS site_ids
       FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
    [actorUserId],
  );

  const siteIds = rows[0]?.site_ids ?? [];

  return db.withSiteScopeClient({ siteIds, userId: actorUserId }, run);
}
