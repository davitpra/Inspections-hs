import { Injectable } from '@nestjs/common';
import type {
  Finding,
  ManualFindingRequest,
  RiskAssessment,
  RiskAssessmentRequest,
} from '@hs/contracts';
import type { DatabaseError, PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import {
  alreadyReclassified,
  findingForbidden,
  findingNotFound,
  invalidFinding,
} from './findings.errors';
import { foreignManualKeys } from './object-key';

/**
 * Requisitos §7 etapa 4 — Lo que se puede hacer con un hallazgo desde HTTP.
 *
 * La derivación NO está acá: ocurre dentro de la transacción de la ingesta, en
 * `inspections/submissions.service.ts`, con la función pura de `derive.ts`. Este
 * servicio es el resto — reportar a mano, clasificar, y leer.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor (migración 0010):
 *
 *   - Que la ubicación sea del sitio del hallazgo   → FK compuesta.
 *   - Que un hallazgo manual no tenga `item_key`    → CHECK de origen.
 *   - Que exista al menos una foto                  → restricción diferida.
 *   - Que el nivel de riesgo sea el de la matriz    → columna generada.
 *   - Que reclasificar lleve motivo                 → CHECK de motivo.
 *   - Que la historia no se bifurque                → único de `supersedes_id`.
 *   - Que una planta no vea la otra                 → política RLS. No hay `WHERE
 *     site_id` en ninguna consulta de este archivo.
 *
 * Lo que sí comprueba: los roles —que el motor no conoce— y que la ubicación esté
 * activa en el camino manual, que es una regla del momento y no del registro.
 */
@Injectable()
export class FindingsService {
  constructor(private readonly db: DbService) {}

  /**
   * El hallazgo de entrada manual: el peligro que alguien ve fuera de una inspección,
   * y el casi-accidente presenciado que §5 riesgo F manda por este camino.
   *
   * Nace clasificado, a diferencia de uno derivado. El inspector no clasifica —no es
   * su trabajo y está en el campo—, pero quien reporta a mano ya está en la aplicación
   * con la lista delante, y un hallazgo sin riesgo asignado es uno que nadie prioriza.
   */
  async report(session: SessionScope, payload: ManualFindingRequest): Promise<Finding> {
    if (!CAN_REPORT.has(session.role)) {
      throw findingForbidden('Your role cannot report a finding');
    }

    return this.db.withSessionClient(session, async (client) => {
      await this.requireActiveLocation(client, payload.site_id, payload.details.location_id);

      // El prefijo del camino manual: no hay inspección programada de la que colgar,
      // así que la carpeta es la del borrador que el cliente creó antes de subir.
      const foreign = foreignManualKeys(
        payload.details.photo_object_keys,
        payload.site_id,
        payload.draft_finding_id,
      );

      if (foreign.length > 0) {
        throw invalidFinding('The finding references files that do not belong to it');
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO finding (site_id, origin, location_id, description, reported_by, occurred_at)
         VALUES ($1, 'manual', $2, $3, $4, $5)
         RETURNING id`,
        [
          payload.site_id,
          payload.details.location_id,
          payload.details.description,
          session.userId,
          payload.occurred_at,
        ],
      );

      const findingId = rows[0]?.id;

      if (!findingId) throw invalidFinding('The finding could not be recorded');

      await this.insertPhotos(
        client,
        findingId,
        payload.site_id,
        payload.details.photo_object_keys,
      );

      await this.insertAssessment(client, findingId, payload.site_id, session.userId, {
        ...payload.classification,
        reason: undefined,
      });

      return this.readOne(client, findingId);
    });
  }

  /**
   * Clasificar y reclasificar son la misma operación: insertar una fila.
   *
   * La diferencia la decide el estado —si ya hay una vigente, la nueva la supera y
   * exige motivo— y no un endpoint distinto. Dos rutas para dos casos del mismo hecho
   * habrían dejado al cliente decidiendo cuál llamar, con la respuesta a esa pregunta
   * en la base.
   */
  async classify(
    session: SessionScope,
    findingId: string,
    payload: RiskAssessmentRequest,
  ): Promise<Finding> {
    if (session.role !== 'hs_coordinator') {
      throw findingForbidden('Only the HS coordinator classifies a finding');
    }

    return this.db.withSessionClient(session, async (client) => {
      const finding = await this.requireFinding(client, findingId);
      const current = await this.currentAssessmentId(client, findingId);

      // Las dos mitades del CHECK de la migración, comprobadas acá para devolver un
      // 400 legible en vez de un error de restricción.
      if (current !== null && payload.reason === undefined) {
        throw invalidFinding('Reclassifying a finding requires a reason');
      }

      if (current === null && payload.reason !== undefined) {
        throw invalidFinding('The first classification of a finding does not take a reason');
      }

      await this.insertAssessment(client, findingId, finding.site_id, session.userId, {
        ...payload,
        supersedesId: current,
      });

      return this.readOne(client, findingId);
    });
  }

  /**
   * El listado, con la clasificación vigente de cada hallazgo o su ausencia.
   *
   * Sin `WHERE site_id`: el recorte lo hace la política sobre la transacción (ADR-002).
   * Un miembro del JHSC de St. Thomas no ve Glencoe porque la política no se lo
   * devuelve, no porque este método se acuerde de filtrar.
   */
  async list(session: SessionScope): Promise<Finding[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<FindingRow>(
        `${FINDING_SELECT} ORDER BY f.recorded_at DESC`,
      );

      return rows.map(toFinding);
    });
  }

  async get(session: SessionScope, findingId: string): Promise<Finding> {
    return this.db.withSessionClient(session, (client) => this.readOne(client, findingId));
  }

  // -------------------------------------------------------------------------

  /**
   * La ubicación tiene que estar ACTIVA para un hallazgo manual, y esa exigencia no
   * vale para uno derivado.
   *
   * La asimetría es la decisión, no un descuido: el dispositivo lleva el catálogo de
   * cuando se preparó la inspección, y rechazar un envío porque el coordinador
   * desactivó una ubicación mientras el inspector caminaba convertiría una edición
   * administrativa en una inspección perdida. Reportar a mano es online y contra una
   * lista fresca; ahí no hay excusa.
   *
   * Que la ubicación sea del sitio no se comprueba acá: lo hace la FK compuesta.
   */
  private async requireActiveLocation(
    client: PoolClient,
    siteId: string,
    locationId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ deactivated_at: Date | null }>(
      `SELECT deactivated_at FROM location WHERE id = $1 AND site_id = $2`,
      [locationId, siteId],
    );

    const row = rows[0];

    if (!row) throw invalidFinding('No such location within your scope');
    if (row.deactivated_at !== null) throw invalidFinding('That location is deactivated');
  }

  private async insertPhotos(
    client: PoolClient,
    findingId: string,
    siteId: string,
    objectKeys: readonly string[],
  ): Promise<void> {
    await client.query(
      `INSERT INTO finding_photo (finding_id, site_id, object_key)
       SELECT $1, $2, k FROM unnest($3::text[]) AS k`,
      [findingId, siteId, [...objectKeys]],
    );
  }

  private async insertAssessment(
    client: PoolClient,
    findingId: string,
    siteId: string,
    assessedBy: string,
    input: RiskAssessmentRequest & { supersedesId?: string | null },
  ): Promise<void> {
    try {
      await client.query(
        `INSERT INTO finding_risk_assessment (finding_id, site_id, probability, severity,
                                              control_level, supersedes_id, reason, assessed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          findingId,
          siteId,
          input.probability,
          input.severity,
          input.control_level,
          input.supersedesId ?? null,
          input.reason ?? null,
          assessedBy,
        ],
      );
    } catch (error) {
      // Alguien más reclasificó entre la lectura de la vigente y esta escritura. El
      // único del motor es lo que lo detecta; acá solo se traduce.
      if (isUniqueViolation(error, 'finding_risk_assessment_supersedes_id_key')) {
        throw alreadyReclassified();
      }

      if (isUniqueViolation(error, 'finding_risk_assessment_initial_uq')) {
        throw alreadyReclassified();
      }

      throw error;
    }
  }

  /** La vigente: la que nadie supera. `null` significa sin clasificar (design D10). */
  private async currentAssessmentId(
    client: PoolClient,
    findingId: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT a.id
         FROM finding_risk_assessment a
        WHERE a.finding_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM finding_risk_assessment s WHERE s.supersedes_id = a.id)`,
      [findingId],
    );

    return rows[0]?.id ?? null;
  }

  private async requireFinding(
    client: PoolClient,
    findingId: string,
  ): Promise<{ site_id: string }> {
    const { rows } = await client.query<{ site_id: string }>(
      `SELECT site_id FROM finding WHERE id = $1`,
      [findingId],
    );

    const row = rows[0];

    // La de otra planta no devuelve cero filas porque se la filtre: la transacción no
    // la ve. Por eso responde igual que uno que no existe.
    if (!row) throw findingNotFound();

    return row;
  }

  private async readOne(client: PoolClient, findingId: string): Promise<Finding> {
    const { rows } = await client.query<FindingRow>(`${FINDING_SELECT} WHERE f.id = $1`, [
      findingId,
    ]);

    const row = rows[0];

    if (!row) throw findingNotFound();

    return toFinding(row);
  }
}

/** Quién puede cargar un hallazgo a mano (§4, tabla de roles). */
const CAN_REPORT = new Set(['supervisor', 'management', 'hs_coordinator']);

/**
 * La clasificación vigente se resuelve con un `LEFT JOIN LATERAL` sobre la fila que
 * nadie supera, apoyado en el índice parcial `finding_risk_assessment_initial_uq`.
 *
 * `LEFT` y no `INNER`: un hallazgo sin clasificar tiene que aparecer en el listado, y
 * aparecer como lo que es. Es la consulta que hace que "sin clasificar" pueda ser una
 * ausencia en vez de un valor guardado.
 */
const FINDING_SELECT = `
  SELECT f.id, f.site_id, f.origin, f.inspection_id, f.template_version_item_id, f.item_key,
         f.location_id, f.description, f.reported_by, f.occurred_at, f.recorded_at,
         COALESCE(p.keys, ARRAY[]::text[]) AS photo_object_keys,
         a.id AS assessment_id, a.probability, a.severity, a.risk_level, a.control_level,
         a.reason, a.supersedes_id, a.assessed_by, a.assessed_at,
         rec.prior_count, rec.prior_count_site_wide, rec.window_months,
         rec.first_prior_occurred_at, rec.is_recurrent
    FROM finding f
    LEFT JOIN LATERAL (
      SELECT array_agg(fp.object_key ORDER BY fp.created_at, fp.id) AS keys
        FROM finding_photo fp WHERE fp.finding_id = f.id
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT r.* FROM finding_risk_assessment r
       WHERE r.finding_id = f.id
         AND NOT EXISTS (
           SELECT 1 FROM finding_risk_assessment s WHERE s.supersedes_id = r.id)
    ) a ON true
    -- La marca de recurrencia (etapa 7). LEFT y no INNER porque hay dos clases de
    -- hallazgo sin marca que igual tienen que aparecer en el listado: los manuales, que
    -- no tienen item_key y por lo tanto no tienen serie, y los anteriores a la
    -- migración 0013, que nacieron antes de que el mecanismo existiera.
    LEFT JOIN finding_recurrence rec ON rec.finding_id = f.id`;

interface FindingRow {
  id: string;
  site_id: string;
  origin: Finding['origin'];
  inspection_id: string | null;
  template_version_item_id: string | null;
  item_key: string | null;
  location_id: string;
  description: string;
  reported_by: string;
  occurred_at: Date;
  recorded_at: Date;
  photo_object_keys: string[];
  assessment_id: string | null;
  probability: RiskAssessment['probability'] | null;
  severity: RiskAssessment['severity'] | null;
  risk_level: RiskAssessment['risk_level'] | null;
  control_level: RiskAssessment['control_level'] | null;
  reason: string | null;
  supersedes_id: string | null;
  assessed_by: string | null;
  assessed_at: Date | null;
  // Los cinco son null juntos: o hay fila de marca o no la hay.
  prior_count: number | null;
  prior_count_site_wide: number | null;
  window_months: number | null;
  first_prior_occurred_at: Date | null;
  is_recurrent: boolean | null;
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    site_id: row.site_id,
    origin: row.origin,
    inspection_id: row.inspection_id,
    template_version_item_id: row.template_version_item_id,
    item_key: row.item_key,
    location_id: row.location_id,
    description: row.description,
    photo_object_keys: row.photo_object_keys,
    reported_by: row.reported_by,
    occurred_at: row.occurred_at.toISOString(),
    recorded_at: row.recorded_at.toISOString(),
    // La ausencia de fila ES el estado "sin clasificar". No hay `status` que mantener.
    assessment:
      row.assessment_id === null
        ? null
        : {
            id: row.assessment_id,
            probability: row.probability as RiskAssessment['probability'],
            severity: row.severity as RiskAssessment['severity'],
            risk_level: row.risk_level as RiskAssessment['risk_level'],
            control_level: row.control_level as RiskAssessment['control_level'],
            reason: row.reason,
            supersedes_id: row.supersedes_id,
            assessed_by: row.assessed_by as string,
            assessed_at: (row.assessed_at as Date).toISOString(),
          },
    // La ausencia de fila y `is_recurrent: false` dicen cosas distintas y el contrato
    // las separa (design D8): `null` es "hallazgo manual, NUNCA se lo comparó con la
    // historia", y `false` es "se lo comparó, y es la primera vez".
    recurrence:
      row.prior_count === null
        ? null
        : {
            prior_count: row.prior_count,
            prior_count_site_wide: row.prior_count_site_wide as number,
            window_months: row.window_months as number,
            first_prior_occurred_at:
              row.first_prior_occurred_at?.toISOString() ?? null,
            is_recurrent: row.is_recurrent as boolean,
          },
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as DatabaseError | undefined;

  return candidate?.code === '23505' && candidate.constraint === constraint;
}

/**
 * Los hallazgos que abrió un envío, para leerlo de vuelta.
 *
 * Función libre y con `PoolClient`, igual que `insertRecurrenceMarks`: corre DENTRO de la
 * transacción de quien la llama —`inspections`, que es la dirección de dependencia que
 * declara ADR-008— y no abre una propia. Sin `WHERE site_id`: el recorte es la política
 * sobre esa transacción.
 *
 * Vive acá y no en un archivo aparte porque reusa `FINDING_SELECT` y `toFinding`, que son
 * privados de este módulo. Un segundo `SELECT` escrito afuera sería una segunda definición
 * de qué es un hallazgo, y la clasificación vigente y la marca de recurrencia —los dos
 * `LEFT JOIN LATERAL` de arriba— serían lo primero en desincronizarse.
 *
 * `f.inspection_id = $1` alcanza para excluir los manuales: el `CHECK` de la migración
 * impide que un hallazgo manual tenga inspección, así que filtrar por `origin` además
 * sería decir dos veces lo mismo.
 */
export async function findingsForInspection(
  client: PoolClient,
  inspectionId: string,
): Promise<Finding[]> {
  const { rows } = await client.query<FindingRow>(
    `${FINDING_SELECT} WHERE f.inspection_id = $1 ORDER BY f.recorded_at, f.id`,
    [inspectionId],
  );

  return rows.map(toFinding);
}
