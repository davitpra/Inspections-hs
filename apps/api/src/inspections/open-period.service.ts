import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import { JobsService } from '../jobs/jobs.service';
import { OPEN_PERIOD_CRON, OPEN_PERIOD_JOB, SITE_TIME_ZONE } from '../jobs/job-registry';
import { currentPeriodStart } from './period';
import { LATEST_PUBLISHED_VERSION_CTE } from '../templates/published-version.sql';

/**
 * ADR-005 — La apertura mensual de las inspecciones del período, por planta.
 *
 * DOS PROPIEDADES QUE NO ESTÁN EN ESTE ARCHIVO, y es donde tienen que no estar:
 *
 *   - **La idempotencia.** El `INSERT` va con `ON CONFLICT DO NOTHING` contra el único
 *     parcial `scheduled_inspection_open_period_uq`, y lo que devuelve `RETURNING` es
 *     lo que se abrió. No hay bookkeeping propio, ni un `SELECT` previo que pregunte
 *     si ya existe: bajo dos réplicas, ese `SELECT` respondería que no a las dos.
 *   - **El aislamiento.** El handler declara el alcance de TODAS las plantas activas y
 *     deja que la política haga el resto. No hay `WHERE site_id` en ninguna consulta.
 *
 * El trabajo no tiene sesión, así que usa `withSiteScope` —la vía de los seeds y los
 * comandos— y no `withSessionScope`. Esa distinción es exactamente para lo que existen
 * los dos helpers. Consecuencia declarada: las entradas de auditoría que genera llevan
 * actor nulo, y `scheduled_by` queda en `NULL`. El sistema actuó, no una persona.
 */
@Injectable()
export class OpenPeriodService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OpenPeriodService.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(OPEN_PERIOD_JOB, async (payload) => {
      const result = await this.run(payload.now ? new Date(payload.now) : new Date());

      this.logger.log(
        `Período ${result.periodStart}: ${result.opened} inspecciones abiertas, ` +
          `${result.notified} notificaciones.`,
      );
    });

    await this.jobs.schedule(OPEN_PERIOD_JOB, OPEN_PERIOD_CRON, SITE_TIME_ZONE, {});
  }

  /**
   * Abre el período de `now` y devuelve qué hizo.
   *
   * `now` es un parámetro y no `new Date()` adentro: es lo que permite reabrir a mano
   * un período que quedó sin abrir porque el planificador estuvo caído, sin tener que
   * mover el reloj del servidor. Los tests lo usan por la misma puerta.
   */
  async run(now: Date): Promise<OpenPeriodResult> {
    const periodStart = currentPeriodStart(now, SITE_TIME_ZONE);

    // Las plantas activas se resuelven SIN alcance: `site` no lleva política RLS —es
    // dato de referencia de la organización— y es de donde sale el alcance que declara
    // el resto del trabajo. Preguntarlo con alcance sería un arranque circular.
    const { rows: sites } = await this.db.unscopedPool.query<{ id: string }>(
      'SELECT id FROM site WHERE deactivated_at IS NULL ORDER BY code',
    );

    const siteIds = sites.map((row) => row.id);

    if (siteIds.length === 0) return { periodStart, opened: 0, notified: 0 };

    return this.db.withSiteScopeClient({ siteIds, userId: null }, async (client) => {
      const opened = await openPeriod(client, periodStart);
      const notified = await notifyCoordinators(client, periodStart, opened);

      return { periodStart, opened: opened.length, notified };
    });
  }
}

export interface OpenPeriodResult {
  periodStart: string;
  opened: number;
  notified: number;
}

interface OpenedRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  template_id: string;
  template_name: string;
  inspector_id: string | null;
  period_end: string;
}

/**
 * Una sola sentencia para todas las reglas activas de todas las plantas.
 *
 * La versión que se congela es la de `LATEST_PUBLISHED_VERSION_CTE`: la más alta
 * publicada EN ESTE INSTANTE. A partir del `INSERT` no se vuelve a mirar — el trigger de
 * guarda y el GRANT por columna hacen que no se pueda. La expresión es compartida a
 * propósito: el listado de plantillas ofrece exactamente la versión que esto congela.
 *
 * Una regla cuya plantilla no tiene ninguna versión publicada simplemente no produce
 * fila: el `JOIN` no encuentra nada. No es un error del trabajo — el endpoint de alta
 * de reglas ya rechaza ese caso, y una plantilla despublicada no debería tumbar la
 * apertura de las otras plantas.
 */
async function openPeriod(client: PoolClient, periodStart: string): Promise<OpenedRow[]> {
  const { rows } = await client.query<OpenedRow>(
    `WITH latest AS (${LATEST_PUBLISHED_VERSION_CTE}),
     inserted AS (
       INSERT INTO scheduled_inspection
         (site_id, period_start, template_id, template_version_id, inspector_id, scheduled_by)
       SELECT s.site_id, $1::date, s.template_id, latest.version_id, s.default_inspector_id, NULL
         FROM inspection_schedule s
         JOIN latest ON latest.template_id = s.template_id
        WHERE s.deactivated_at IS NULL
       ON CONFLICT DO NOTHING
       RETURNING id, site_id, template_id, inspector_id, period_end
     )
     SELECT i.id, i.site_id, i.template_id, t.name AS template_name,
            i.inspector_id, i.period_end::text AS period_end
       FROM inserted i
       JOIN template t ON t.id = i.template_id`,
    [periodStart],
  );

  return rows;
}

/**
 * Una notificación por coordinador activo con alcance en la planta, y SOLO por las
 * plantas donde se abrió algo.
 *
 * ADR-011 design D9: no hay correo. Esto es la bandeja o no es nada.
 *
 * La deduplicación es el único `(user_id, kind, dedupe_key)` de la tabla, con
 * `<site_id>:<period_start>` como clave. Un `SELECT` previo que preguntara si ya
 * notificó no serviría: bajo dos réplicas concurrentes respondería que no a las dos.
 */
async function notifyCoordinators(
  client: PoolClient,
  periodStart: string,
  opened: readonly OpenedRow[],
): Promise<number> {
  if (opened.length === 0) return 0;

  const bySite = new Map<string, OpenedRow[]>();

  for (const row of opened) {
    bySite.set(row.site_id, [...(bySite.get(row.site_id) ?? []), row]);
  }

  let notified = 0;

  for (const [siteId, rows] of bySite) {
    const first = rows[0];
    if (!first) continue;

    const payload = {
      period_start: periodStart,
      period_end: first.period_end,
      opened: rows.map((row) => ({
        scheduled_inspection_id: row.id,
        template_id: row.template_id,
        template_name: row.template_name,
        inspector_id: row.inspector_id,
      })),
    };

    // Los destinatarios salen de una subconsulta y no de un `SELECT` seguido de un
    // bucle de `INSERT`: es una sola sentencia, así que un coordinador dado de alta a
    // mitad del trabajo no queda a medias.
    const { rowCount } = await client.query(
      `INSERT INTO notification (user_id, site_id, kind, dedupe_key, payload)
       SELECT u.id, $1::uuid, 'inspection_period_opened', $2, $3::jsonb
         FROM app_user u
         JOIN user_site_scope s ON s.user_id = u.id
                               AND s.site_id = $1::uuid
                               AND s.revoked_at IS NULL
        WHERE u.role = 'hs_coordinator'
          AND u.deactivated_at IS NULL
       ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING`,
      [siteId, `${siteId}:${periodStart}`, JSON.stringify(payload)],
    );

    notified += rowCount ?? 0;
  }

  return notified;
}
