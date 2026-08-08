import { Injectable } from '@nestjs/common';
import type {
  CreateInspectionSchedule,
  CreateScheduledInspection,
  InspectionSchedule,
  PendingInspection,
  Role,
  ScheduledInspection,
  UpdateInspectionSchedule,
} from '@hs/contracts';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import { forbidden } from '../auth/auth.errors';
import type { SessionScope } from '../db/site-scope';
import { SITE_TIME_ZONE } from '../jobs/job-registry';
import { civilDate } from './period';
import { inspectionNotFound, inspectorInvalid, templateNotPublishable } from './inspections.errors';

/**
 * Requisitos §4 — La obligación de inspeccionar: quién la crea, quién la reasigna,
 * quién la cancela y qué ve cada inspector como pendiente.
 *
 * TRES REGLAS QUE ESTE SERVICIO **NO** APLICA, porque las aplica el motor y aplicarlas
 * dos veces es la forma de que una de las dos copias envejezca:
 *
 *   - El aislamiento por planta. No hay un solo `WHERE site_id IN (...)` acá: la
 *     política de `hs_apply_site_isolation` recorta, y una transacción sin alcance no
 *     ve nada. Es también lo que hace que un `site_id` del cuerpo fuera del alcance de
 *     la sesión no inserte nada, en vez de necesitar una comprobación.
 *   - El congelamiento de `template_version_id`. No hay método que la cambie porque el
 *     GRANT por columna y el trigger de guarda la rechazan; escribir la comprobación
 *     acá sugeriría que sin ella se podría.
 *   - La unicidad del período abierto. Es un único parcial, y el trabajo de apertura se
 *     apoya en él con `ON CONFLICT DO NOTHING`.
 *
 * Lo que sí aplica: el rol del actor y la validez del inspector. Ninguna de las dos la
 * puede expresar una FK — dependen de `user_site_scope`, que cambia con el tiempo.
 */
@Injectable()
export class InspectionsService {
  constructor(private readonly db: DbService) {}

  // -------------------------------------------------------------------------
  // Reglas de recurrencia

  async listSchedules(session: SessionScope): Promise<InspectionSchedule[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<ScheduleRow>(`${SCHEDULE_SELECT} ORDER BY t.name`);
      return rows.map(toSchedule);
    });
  }

  async createSchedule(
    session: SessionScope,
    input: CreateInspectionSchedule,
  ): Promise<InspectionSchedule> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      // Una regla sobre una plantilla sin versión publicada no tiene nada que abrir: el
      // trabajo la miraría todos los días y no produciría nada, en silencio.
      await this.requirePublishedTemplate(client, input.template_id);

      if (input.default_inspector_id) {
        await this.requireInspector(client, input.default_inspector_id, input.site_id);
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO inspection_schedule (site_id, template_id, default_inspector_id, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [input.site_id, input.template_id, input.default_inspector_id ?? null, session.userId],
      );

      return this.scheduleById(client, requireRow(rows).id);
    });
  }

  async updateSchedule(
    session: SessionScope,
    id: string,
    input: UpdateInspectionSchedule,
  ): Promise<InspectionSchedule> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const current = await this.scheduleById(client, id);

      if (input.default_inspector_id) {
        await this.requireInspector(client, input.default_inspector_id, current.site_id);
      }

      const { rowCount } = await client.query(
        `UPDATE inspection_schedule
            SET default_inspector_id = CASE WHEN $2::bool
                                            THEN $3::uuid ELSE default_inspector_id END,
                deactivated_at = CASE WHEN $4::bool
                                      THEN CASE WHEN $5::bool THEN now() ELSE NULL END
                                      ELSE deactivated_at END
          WHERE id = $1`,
        [
          id,
          input.default_inspector_id !== undefined,
          input.default_inspector_id ?? null,
          input.deactivated !== undefined,
          input.deactivated ?? false,
        ],
      );

      if (rowCount === 0) throw inspectionNotFound();

      return this.scheduleById(client, id);
    });
  }

  // -------------------------------------------------------------------------
  // Inspecciones programadas

  async listScheduled(session: SessionScope): Promise<ScheduledInspection[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<ScheduledRow>(
        `${SCHEDULED_SELECT} ORDER BY si.period_start DESC, t.name`,
      );

      return rows.map(toScheduled);
    });
  }

  /**
   * Programa fuera del calendario. La versión NO viene del cliente: se resuelve como la
   * más alta publicada en este instante, y a partir de acá queda congelada.
   */
  async schedule(
    session: SessionScope,
    input: CreateScheduledInspection,
  ): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const versionId = await this.requirePublishedTemplate(client, input.template_id);

      if (input.inspector_id) {
        await this.requireInspector(client, input.inspector_id, input.site_id);
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO scheduled_inspection
           (site_id, period_start, template_id, template_version_id, inspector_id, scheduled_by)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.site_id,
          input.period_start,
          input.template_id,
          versionId,
          input.inspector_id ?? null,
          session.userId,
        ],
      );

      return this.scheduledById(client, requireRow(rows).id);
    });
  }

  async assignInspector(
    session: SessionScope,
    id: string,
    inspectorId: string,
  ): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const current = await this.scheduledById(client, id);

      await this.requireInspector(client, inspectorId, current.site_id);

      // El trigger de auditoría escribe `inspection.reassigned` con el anterior y el
      // nuevo. No se escribe desde acá: una segunda vía de reasignación —un script de
      // corrección, por ejemplo— produciría el mismo registro sin acordarse de nada.
      await client.query('UPDATE scheduled_inspection SET inspector_id = $2 WHERE id = $1', [
        id,
        inspectorId,
      ]);

      return this.scheduledById(client, id);
    });
  }

  async cancel(session: SessionScope, id: string, reason: string): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      await this.scheduledById(client, id);

      // Los dos campos juntos: el CHECK del motor exige que sean ambos o ninguno, y
      // que no se pueda deshacer lo garantiza el trigger de guarda.
      await client.query(
        `UPDATE scheduled_inspection
            SET cancelled_at = now(), cancellation_reason = $2
          WHERE id = $1 AND cancelled_at IS NULL`,
        [id, reason],
      );

      return this.scheduledById(client, id);
    });
  }

  /**
   * Lo que el solicitante todavía debe.
   *
   * Sin `WHERE site_id`: recorta la política. Lo único que agrega el endpoint es "es
   * mío" y "no está cancelada", que no son alcance sino filtro de la pantalla.
   */
  async pendingFor(session: SessionScope): Promise<PendingInspection[]> {
    const today = civilDate(new Date(), SITE_TIME_ZONE);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<PendingRow>(
        `SELECT si.id,
                si.site_id,
                si.period_start::text AS period_start,
                si.period_end::text AS period_end,
                t.name AS template_name,
                si.template_version_id,
                (si.period_end < $2::date) AS overdue
           FROM scheduled_inspection si
           JOIN template t ON t.id = si.template_id
          WHERE si.inspector_id = $1
            AND si.cancelled_at IS NULL
          ORDER BY si.period_end`,
        [session.userId, today],
      );

      return rows.map((row) => ({
        id: row.id,
        site_id: row.site_id,
        period_start: row.period_start,
        period_end: row.period_end,
        template_name: row.template_name,
        template_version_id: row.template_version_id,
        overdue: row.overdue,
      }));
    });
  }

  // -------------------------------------------------------------------------

  private requireCoordinator(session: { role: string }): void {
    if (session.role !== 'hs_coordinator') {
      throw forbidden('Only the HS coordinator can administer inspection scheduling');
    }
  }

  /**
   * La versión más alta publicada de una plantilla. Es lo que se congela al programar.
   */
  private async requirePublishedTemplate(client: PoolClient, templateId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM template_version
        WHERE template_id = $1
        ORDER BY version DESC
        LIMIT 1`,
      [templateId],
    );

    const row = rows[0];
    if (!row) throw templateNotPublishable(templateId);

    return row.id;
  }

  /**
   * Un inspector válido es `jhsc_member` con alcance VIGENTE en esa planta.
   *
   * §4, nota de vocabulario: los 7 miembros del JHSC son los únicos que ejecutan
   * inspecciones, y "inspector" y "miembro del JHSC" son la misma cosa. Un gerente con
   * las mejores intenciones no puede recibir una.
   */
  private async requireInspector(
    client: PoolClient,
    inspectorId: string,
    siteId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ role: Role; in_scope: boolean }>(
      `SELECT u.role,
              EXISTS (
                SELECT 1 FROM user_site_scope s
                 WHERE s.user_id = u.id AND s.site_id = $2 AND s.revoked_at IS NULL
              ) AS in_scope
         FROM app_user u
        WHERE u.id = $1 AND u.deactivated_at IS NULL`,
      [inspectorId, siteId],
    );

    const row = rows[0];
    if (!row) throw inspectorInvalid('The account does not exist or is deactivated');

    if (row.role !== 'jhsc_member') {
      throw inspectorInvalid(`Role ${row.role} cannot be assigned an inspection`);
    }

    if (!row.in_scope) {
      throw inspectorInvalid(`The account has no active access to site ${siteId}`);
    }
  }

  private async scheduleById(client: PoolClient, id: string): Promise<InspectionSchedule> {
    const { rows } = await client.query<ScheduleRow>(`${SCHEDULE_SELECT} AND s.id = $1`, [id]);

    const row = rows[0];
    if (!row) throw inspectionNotFound();

    return toSchedule(row);
  }

  private async scheduledById(client: PoolClient, id: string): Promise<ScheduledInspection> {
    const { rows } = await client.query<ScheduledRow>(`${SCHEDULED_SELECT} AND si.id = $1`, [id]);

    const row = rows[0];
    if (!row) throw inspectionNotFound();

    return toScheduled(row);
  }
}

/**
 * El alcance de la sesión, para los métodos que escriben con el cliente crudo.
 *
 * `withSiteScopeClient` pide un `SiteScope` DECLARADO, que es la vía de los seeds y los
 * comandos. Se construye acá a partir de la sesión —nunca de un parámetro del request—
 * y el `userId` viaja para que `app.user_id` quede fijado y los triggers de auditoría
 * sepan quién actuó.
 */
function sessionScope(session: SessionScope): { siteIds: readonly string[]; userId: string } {
  return { siteIds: session.siteIds, userId: session.userId };
}

const SCHEDULE_SELECT = `
  SELECT s.id,
         s.site_id,
         s.template_id,
         t.name AS template_name,
         s.default_inspector_id,
         s.deactivated_at
    FROM inspection_schedule s
    JOIN template t ON t.id = s.template_id
   WHERE true`;

const SCHEDULED_SELECT = `
  SELECT si.id,
         si.site_id,
         si.period_start::text AS period_start,
         si.period_end::text AS period_end,
         si.template_id,
         t.name AS template_name,
         si.template_version_id,
         tv.version AS template_version,
         si.inspector_id,
         si.scheduled_at,
         si.scheduled_by,
         si.cancelled_at,
         si.cancellation_reason
    FROM scheduled_inspection si
    JOIN template t ON t.id = si.template_id
    JOIN template_version tv ON tv.id = si.template_version_id
   WHERE true`;

interface ScheduleRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  template_id: string;
  template_name: string;
  default_inspector_id: string | null;
  deactivated_at: Date | null;
}

interface ScheduledRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  period_start: string;
  period_end: string;
  template_id: string;
  template_name: string;
  template_version_id: string;
  template_version: number;
  inspector_id: string | null;
  scheduled_at: Date;
  scheduled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

interface PendingRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  period_start: string;
  period_end: string;
  template_name: string;
  template_version_id: string;
  overdue: boolean;
}

function toSchedule(row: ScheduleRow): InspectionSchedule {
  return {
    id: row.id,
    site_id: row.site_id,
    template_id: row.template_id,
    template_name: row.template_name,
    default_inspector_id: row.default_inspector_id,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

function toScheduled(row: ScheduledRow): ScheduledInspection {
  return {
    id: row.id,
    site_id: row.site_id,
    period_start: row.period_start,
    period_end: row.period_end,
    template_id: row.template_id,
    template_name: row.template_name,
    template_version_id: row.template_version_id,
    template_version: row.template_version,
    inspector_id: row.inspector_id,
    scheduled_at: row.scheduled_at.toISOString(),
    scheduled_by: row.scheduled_by,
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
    cancellation_reason: row.cancellation_reason,
  };
}

function requireRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('La sentencia no devolvió ninguna fila.');
  return row;
}
