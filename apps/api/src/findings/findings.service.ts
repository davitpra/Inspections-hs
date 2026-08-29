import { Injectable } from '@nestjs/common';
import type {
  Finding,
  ManualFindingRequest,
} from '@hs/contracts';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { findingForbidden, findingNotFound, invalidFinding } from './findings.errors';
import { foreignManualKeys } from './object-key';

/**
 * Requisitos §7 etapa 4 — Lo que se puede hacer con un hallazgo desde HTTP.
 *
 * La derivación NO está acá: ocurre dentro de la transacción de la ingesta, en
 * `inspections/submissions.service.ts`, con la función pura de `derive.ts`. Este
 * servicio es el resto — reportar a mano y leer.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor (migración 0010):
 *
 *   - Que la ubicación sea del sitio del hallazgo   → FK compuesta.
 *   - Que un hallazgo manual no tenga `item_key`    → CHECK de origen.
 *   - Que exista al menos una foto                  → restricción diferida.
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
   * No lleva clasificación: el coordinador declara la fecha límite al abrir una acción.
   */
  async report(session: SessionScope, payload: ManualFindingRequest): Promise<Finding> {
    if (!CAN_REPORT.has(session.role)) {
      throw findingForbidden('Your role cannot report a finding');
    }

    return this.db.withSessionClient(session, async (client) => {
      if (payload.details.location_id !== null) {
        await this.requireActiveLocation(client, payload.site_id, payload.details.location_id);
      }

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

      return this.readOne(client, findingId);
    });
  }

  /**
   * El listado de hallazgos y sus fotos.
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

/** Las fotos se agregan en la consulta para que la lectura del hallazgo sea completa. */
const FINDING_SELECT = `
  SELECT f.id, f.site_id, f.origin, f.inspection_id, f.template_version_item_id, f.item_key,
         f.location_id, f.description, f.reported_by, f.occurred_at, f.recorded_at,
         COALESCE(p.keys, ARRAY[]::text[]) AS photo_object_keys
    FROM finding f
    LEFT JOIN LATERAL (
      SELECT array_agg(fp.object_key ORDER BY fp.created_at, fp.id) AS keys
        FROM finding_photo fp WHERE fp.finding_id = f.id
    ) p ON true`;

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
  };
}

/**
 * Los hallazgos que abrió un envío, para leerlo de vuelta.
 *
 * Función libre y con `PoolClient`: corre DENTRO de la transacción de quien la llama
 * —`inspections`, que es la dirección de dependencia que declara ADR-008— y no abre una
 * propia. Sin `WHERE site_id`: el recorte es la política sobre esa transacción.
 *
 * Vive acá y no en un archivo aparte porque reusa `FINDING_SELECT` y `toFinding`, que son
 * privados de este módulo. Un segundo `SELECT` escrito afuera sería una segunda definición
 * de qué es un hallazgo, y las fotos agregadas serían lo primero en desincronizarse.
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
