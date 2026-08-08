import type { Pool } from 'pg';

import { inScope, one } from './postgres';

/**
 * Helpers de programación para los tests de integración.
 *
 * Las tres tablas del change llevan política RLS, así que TODO lo de acá declara
 * alcance — igual que lo hará cualquier request y que lo hace el trabajo de apertura.
 */

/**
 * Como `inScope`, pero declarando además QUIÉN actúa.
 *
 * `app.user_id` es lo que el trigger de auditoría lee para llenar `actor_user_id`, y
 * tiene que fijarse en la MISMA conexión y la misma transacción que la sentencia — un
 * `set_config` en un cliente del pool y la sentencia en otro no se ven entre sí. En el
 * camino real esto lo hace `withSessionScope`; acá se hace a mano porque el test le
 * habla a la base y no a la API.
 */
export async function inScopeAs<T extends Record<string, unknown>>(
  pool: Pool,
  siteIds: readonly string[],
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', siteIds.join(',')]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);

    const result = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Crea una regla de recurrencia y devuelve su id. */
export async function createSchedule(
  pool: Pool,
  siteId: string,
  templateId: string,
  defaultInspectorId: string | null = null,
): Promise<string> {
  const rows = await inScope<{ id: string }>(
    pool,
    [siteId],
    `INSERT INTO inspection_schedule (site_id, template_id, default_inspector_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [siteId, templateId, defaultInspectorId],
  );

  return one(rows).id;
}

export interface ScheduledSpec {
  siteId: string;
  periodStart: string;
  templateId: string;
  templateVersionId: string;
  inspectorId?: string | null;
  scheduledBy?: string | null;
}

/** Programa una inspección por la vía directa y devuelve su id. */
export async function scheduleInspection(pool: Pool, spec: ScheduledSpec): Promise<string> {
  const rows = await inScope<{ id: string }>(
    pool,
    [spec.siteId],
    `INSERT INTO scheduled_inspection
       (site_id, period_start, template_id, template_version_id, inspector_id, scheduled_by)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     RETURNING id`,
    [
      spec.siteId,
      spec.periodStart,
      spec.templateId,
      spec.templateVersionId,
      spec.inspectorId ?? null,
      spec.scheduledBy ?? null,
    ],
  );

  return one(rows).id;
}

export interface ScheduledRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  period_start: string;
  period_end: string;
  template_id: string;
  template_version_id: string;
  inspector_id: string | null;
  scheduled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

/** Una inspección programada por id, dentro del alcance dado. */
export async function scheduledById(
  pool: Pool,
  siteIds: readonly string[],
  id: string,
): Promise<ScheduledRow> {
  const rows = await inScope<ScheduledRow>(
    pool,
    siteIds,
    `SELECT id, site_id, period_start::text AS period_start, period_end::text AS period_end,
            template_id, template_version_id, inspector_id, scheduled_by,
            cancelled_at, cancellation_reason
       FROM scheduled_inspection WHERE id = $1`,
    [id],
  );

  return one(rows);
}

/** Todas las inspecciones de un período, dentro del alcance dado. */
export async function scheduledForPeriod(
  pool: Pool,
  siteIds: readonly string[],
  periodStart: string,
): Promise<ScheduledRow[]> {
  return inScope<ScheduledRow>(
    pool,
    siteIds,
    `SELECT id, site_id, period_start::text AS period_start, period_end::text AS period_end,
            template_id, template_version_id, inspector_id, scheduled_by,
            cancelled_at, cancellation_reason
       FROM scheduled_inspection
      WHERE period_start = $1::date
      ORDER BY site_id`,
    [periodStart],
  );
}

export interface NotificationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  site_id: string;
  kind: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
}

/** Las notificaciones de una cuenta, dentro del alcance dado. */
export async function notificationsFor(
  pool: Pool,
  siteIds: readonly string[],
  userId: string,
): Promise<NotificationRow[]> {
  return inScope<NotificationRow>(
    pool,
    siteIds,
    `SELECT id, user_id, site_id, kind, dedupe_key, payload, read_at
       FROM notification WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
}
