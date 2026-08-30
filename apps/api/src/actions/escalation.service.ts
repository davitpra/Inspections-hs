import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ESCALATION_DAYS,
  ESCALATION_LEVELS,
  ESCALATION_RECIPIENT_ROLE,
  type EscalationLevel,
} from '@hs/contracts';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import { JobsService } from '../jobs/jobs.service';
import { ESCALATE_OVERDUE_CRON, ESCALATE_OVERDUE_JOB, SITE_TIME_ZONE } from '../jobs/job-registry';

/**
 * ADR-005 y §3 R3 — El escalamiento de las acciones vencidas: +3 días al supervisor,
 * +7 a gerencia.
 *
 * DOS PROPIEDADES QUE NO ESTÁN EN ESTE ARCHIVO, y es donde tienen que no estar:
 *
 *   - **La idempotencia.** El `INSERT` de la escalada va con `ON CONFLICT DO NOTHING`
 *     contra el único `corrective_action_escalation_level_uq`, y lo que devuelve
 *     `RETURNING` es lo que se escaló de verdad. No hay bookkeeping propio ni un
 *     `SELECT` previo que pregunte si ya se hizo: bajo dos réplicas ese `SELECT`
 *     respondería que no a las dos, y la gerencia recibiría el mismo aviso dos veces.
 *   - **El aislamiento.** El trabajo declara el alcance de TODAS las plantas activas y
 *     deja que la política haga el resto. No hay `WHERE site_id` en ninguna consulta.
 *
 * Como la apertura de período, el trabajo no tiene sesión: usa `withSiteScope` y las
 * entradas de auditoría que genera llevan actor nulo. **El sistema escaló, no una
 * persona** — que es exactamente lo que el registro tiene que decir.
 */
@Injectable()
export class EscalationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(ESCALATE_OVERDUE_JOB, async (payload) => {
      const result = await this.run(payload.now ? new Date(payload.now) : new Date());

      this.logger.log(
        `Escalamiento: ${result.escalated} acciones, ${result.notified} notificaciones.`,
      );
    });

    await this.jobs.schedule(ESCALATE_OVERDUE_JOB, ESCALATE_OVERDUE_CRON, SITE_TIME_ZONE, {});
  }

  /**
   * Escala lo vencido a la fecha `now` y devuelve qué hizo.
   *
   * `now` es un parámetro y no `new Date()` adentro, igual que en la apertura de
   * período: es lo que permite correr a mano el escalamiento de un día que el
   * planificador estuvo caído, y lo que hace que los tests lo usen por la misma puerta.
   */
  async run(now: Date): Promise<EscalationResult> {
    const { rows: sites } = await this.db.unscopedPool.query<{ id: string }>(
      'SELECT id FROM site WHERE deactivated_at IS NULL ORDER BY code',
    );

    const siteIds = sites.map((row) => row.id);

    if (siteIds.length === 0) return { escalated: 0, notified: 0 };

    return this.db.withSiteScopeClient({ siteIds, userId: null }, async (client) => {
      let escalated = 0;
      let notified = 0;

      // Nivel por nivel, de menor a mayor. Una acción vencida hace ocho días escala a
      // los dos en la misma corrida: el orden es el del recorrido, no una condición.
      for (const level of ESCALATION_LEVELS) {
        const rows = await overdueWithoutEscalation(client, level, now);

        for (const row of rows) {
          notified += await notifyRecipients(client, row, level);
        }

        escalated += rows.length;
      }

      return { escalated, notified };
    });
  }
}

export interface EscalationResult {
  escalated: number;
  notified: number;
}

interface EscalatedRow extends Record<string, unknown> {
  action_id: string;
  site_id: string;
  finding_id: string;
  description: string;
  assignee_person_id: string;
  due_at: Date;
  days_overdue: number;
}

/**
 * Las acciones vencidas de este nivel que todavía no escalaron, escaladas en la misma
 * sentencia.
 *
 * **Una sola sentencia y no un `SELECT` seguido de un `INSERT`**: entre las dos cabe
 * otra corrida del cron, y las dos escalarían. Así, la que pierde la carrera no obtiene
 * fila del `ON CONFLICT DO NOTHING` y por lo tanto no notifica.
 *
 * Las condiciones, en orden:
 *   - el estado vigente no es `closed` — derivado del stream, no de una columna;
 *   - el plazo VIGENTE pasó el umbral del nivel (3 o 7 días);
 *   - no hay ya una escalada de este nivel.
 *
 * **El plazo vigente es la última enmienda o, si no hay ninguna, la fila original**
 * (ADR-018): posponer la fecha antes de empezar mueve el escalamiento todavía no
 * emitido, y las filas ya escritas no se tocan. El responsable y el trabajo del aviso
 * también salen del compromiso vigente.
 *
 * `days_overdue` se calcula y se guarda: el registro dice cuán tarde era CUANDO se
 * escaló, no cuán tarde es hoy.
 */
async function overdueWithoutEscalation(
  client: PoolClient,
  level: EscalationLevel,
  now: Date,
): Promise<EscalatedRow[]> {
  const { rows } = await client.query<EscalatedRow>(
    `WITH overdue AS (
       SELECT a.id, a.site_id,
              COALESCE(eff.due_at, a.due_at) AS due_at,
              floor(extract(epoch FROM ($2::timestamptz - COALESCE(eff.due_at, a.due_at)))
                    / 86400)::int AS days_overdue
         FROM corrective_action a
         LEFT JOIN LATERAL (
           SELECT e.to_state FROM corrective_action_event e
            WHERE e.action_id = a.id
            ORDER BY e.position DESC
            LIMIT 1
         ) s ON true
         LEFT JOIN LATERAL (
           SELECT m.due_at FROM corrective_action_commitment_amendment m
            WHERE m.action_id = a.id
            ORDER BY m.position DESC
            LIMIT 1
         ) eff ON true
        WHERE s.to_state IS DISTINCT FROM 'closed'
          AND COALESCE(eff.due_at, a.due_at) < $2::timestamptz - make_interval(days => $3::int)
     ),
     inserted AS (
       INSERT INTO corrective_action_escalation (action_id, site_id, level, due_at, days_overdue)
       SELECT o.id, o.site_id, $1, o.due_at, o.days_overdue FROM overdue o
       ON CONFLICT (action_id, level) DO NOTHING
       RETURNING action_id, site_id, due_at, days_overdue
     )
     SELECT i.action_id, i.site_id, i.due_at, i.days_overdue,
            a.finding_id,
            COALESCE(eff.description, a.description) AS description,
            COALESCE(eff.assignee_person_id, a.assignee_person_id) AS assignee_person_id
       FROM inserted i
       JOIN corrective_action a ON a.id = i.action_id
       LEFT JOIN LATERAL (
         SELECT m.assignee_person_id, m.description
           FROM corrective_action_commitment_amendment m
          WHERE m.action_id = a.id
          ORDER BY m.position DESC
          LIMIT 1
       ) eff ON true`,
    [level, now, ESCALATION_DAYS[level]],
  );

  return rows;
}

/**
 * El aviso a quien corresponde: supervisores a los +3, gerencia a los +7 (§4, tabla de
 * roles: "Gerencia recibe escalamientos").
 *
 * Los destinatarios salen de una subconsulta y no de un `SELECT` seguido de un bucle de
 * `INSERT`, igual que en la apertura de período: es una sola sentencia, así que un
 * supervisor dado de alta a mitad del trabajo no queda a medias.
 *
 * `dedupe_key` lleva el nivel: el mismo supervisor puede recibir el aviso de los +3 y
 * el de los +7 de la misma acción, y son dos hechos distintos.
 */
async function notifyRecipients(
  client: PoolClient,
  row: EscalatedRow,
  level: EscalationLevel,
): Promise<number> {
  const payload = {
    action_id: row.action_id,
    finding_id: row.finding_id,
    description: row.description,
    assignee_person_id: row.assignee_person_id,
    due_at: row.due_at.toISOString(),
    days_overdue: row.days_overdue,
  };

  const { rowCount } = await client.query(
    `INSERT INTO notification (user_id, site_id, kind, dedupe_key, payload)
     SELECT u.id, $1::uuid, $2, $3, $4::jsonb
       FROM app_user u
       JOIN user_site_scope s ON s.user_id = u.id
                             AND s.site_id = $1::uuid
                             AND s.revoked_at IS NULL
      WHERE u.role = $5
        AND u.deactivated_at IS NULL
     ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING`,
    [
      row.site_id,
      NOTIFICATION_KIND[level],
      `${row.action_id}:${level}`,
      JSON.stringify(payload),
      ESCALATION_RECIPIENT_ROLE[level],
    ],
  );

  return rowCount ?? 0;
}

/**
 * Dos `kind` y no uno con un campo `level`: quién recibe qué es la decisión de R3, y un
 * solo tipo haría que la bandeja del supervisor y la de gerencia se distingan por el
 * contenido en vez de por el destinatario.
 */
export const NOTIFICATION_KIND: Readonly<Record<EscalationLevel, string>> = {
  supervisor: 'corrective_action_overdue_supervisor',
  management: 'corrective_action_overdue_management',
};
