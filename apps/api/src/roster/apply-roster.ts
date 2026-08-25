import type { Pool, PoolClient } from 'pg';

import type { RosterImportReport, RosterRejection } from '@hs/contracts';

import { withSiteScope } from '../db/site-scope';
import type { ParsedRoster, ParsedRosterRow } from './parse-roster-csv';

/**
 * La mitad de la importación que toca la base. Ver `parse-roster-csv.ts` para la
 * mitad pura.
 *
 * Todo confirma junto: las filas aplicadas, la fila de `roster_import`, el desglose
 * por planta y los rechazos. Si algo falla de verdad —la conexión, una restricción
 * inesperada— no queda nada: ni personas a medias ni un reporte que describa un
 * estado que no existe.
 *
 * Las filas rechazadas NO abortan la transacción: son parte del resultado esperado.
 * Un archivo de ADP con tres filas viejas es lo normal, y el comportamiento correcto
 * es aplicar 197 y explicar 3, no rechazar 200. Esa es la diferencia entre un
 * importador que se usa y uno que el coordinador abandona a la segunda vez.
 */

export interface ImportScope {
  /** Los sitios que el importador administra. Fuera de acá, la fila se rechaza. */
  siteIds: readonly string[];
  /** La cuenta que corre la importación. Nulo desde un script de arranque. */
  userId?: string | null;
}

export interface ApplyRosterOptions {
  sourceFilename: string;
  startedAt?: Date;
}

/** Un sitio del catálogo, resuelto una sola vez al principio. */
interface SiteRow extends Record<string, unknown> {
  id: string;
  code: string;
}

export async function applyRoster(
  pool: Pool,
  parsed: ParsedRoster,
  scope: ImportScope,
  options: ApplyRosterOptions,
): Promise<RosterImportReport> {
  return withSiteScope(pool, scope, (client) => applyRosterRows(client, parsed, scope, options));
}

/** Aplica un roster dentro de una transacción y un alcance ya abiertos por el llamador. */
export async function applyRosterRows(
  client: PoolClient,
  parsed: ParsedRoster,
  scope: ImportScope,
  options: ApplyRosterOptions,
): Promise<RosterImportReport> {
  const startedAt = options.startedAt ?? new Date();

  // UNA lectura del catálogo, al principio. La alternativa —intentar el INSERT y
  // atrapar el error de FK— no sirve: en Postgres una sentencia fallida aborta la
  // transacción entera salvo con savepoints, y un savepoint por fila para 200
  // filas es caro y frágil.
  const sites = await siteCodes(client, scope.siteIds);

  const rejections: RosterRejection[] = [...parsed.rejections];
  const appliedBySite = new Map<string, number>();
  let rowsApplied = 0;

  for (const row of parsed.rows) {
    const siteId = sites.get(row.site_code);

    if (siteId === undefined) {
      rejections.push({
        row_number: row.rowNumber,
        employee_number: row.employee_number,
        // El mismo motivo para "no existe" y para "no lo administrás": desde el
        // lado de quien importa son la misma situación, y decir cuál de las dos
        // es filtraría la existencia de una planta que no administra.
        reason: `unknown or out-of-scope site_code "${row.site_code}"`,
      });
      continue;
    }

    const applied = await upsertPerson(client, row, siteId);

    if (!applied) {
      rejections.push({
        row_number: row.rowNumber,
        employee_number: row.employee_number,
        reason: `employee_number "${row.employee_number}" cannot be applied in this import`,
      });
      continue;
    }

    rowsApplied += 1;
    appliedBySite.set(siteId, (appliedBySite.get(siteId) ?? 0) + 1);
  }

  const importId = await recordImport(client, {
    importedBy: scope.userId ?? null,
    sourceFilename: options.sourceFilename,
    rowsRead: parsed.rowsRead,
    rowsApplied,
    rowsRejected: rejections.length,
    startedAt,
  });

  await recordSiteBreakdown(client, importId, appliedBySite, rejections, parsed, sites);
  await recordRejections(client, importId, rejections, parsed);

  return {
    import_id: importId,
    source_filename: options.sourceFilename,
    rows_read: parsed.rowsRead,
    rows_applied: rowsApplied,
    rows_rejected: rejections.length,
    rejections,
  };
}

/** El catálogo de sitios visible bajo el alcance, por `code`. */
async function siteCodes(
  client: PoolClient,
  siteIds: readonly string[],
): Promise<Map<string, string>> {
  if (siteIds.length === 0) {
    return new Map();
  }

  // `site` no lleva RLS (0004), así que el alcance se aplica acá explícitamente: es
  // el único lugar del importador donde hace falta, y sin él una fila de Glencoe
  // entraría en una importación que solo administra St. Thomas.
  const result = await client.query<SiteRow>(
    'SELECT id, code FROM site WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL',
    [[...siteIds]],
  );

  return new Map(result.rows.map((row) => [row.code, row.id]));
}

/**
 * El upsert por `employee_number`. La identidad del roster es el número de ADP
 * (§4), así que el mismo número es la misma persona aunque cambien el apellido y la
 * planta.
 *
 * `deactivated_at` sale SOLO del `status` de esta fila. La ausencia de una persona
 * del archivo no la toca: alguien va a exportar de ADP con un filtro puesto y va a
 * subir 40 filas en lugar de 200, y con la regla contraria ese día desaparecen 160
 * personas de todos los selectores.
 */
async function upsertPerson(
  client: PoolClient,
  row: ParsedRosterRow,
  siteId: string,
): Promise<boolean> {
  const deactivatedAt = row.status === 'inactive' ? new Date() : null;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO person (employee_number, first_name, last_name, site_id, deactivated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_number) DO NOTHING
     RETURNING id`,
    [row.employee_number, row.first_name, row.last_name, siteId, deactivatedAt],
  );

  if (inserted.rowCount === 1) return true;

  // La unicidad es global, pero RLS puede ocultar la fila que causó el conflicto.
  // En ese caso el UPDATE devuelve cero filas y el lote rechaza solo esta entrada.
  const updated = await client.query<{ id: string }>(
    `UPDATE person
        SET first_name = $2,
            last_name = $3,
            site_id = $4,
            deactivated_at = $5
      WHERE employee_number = $1
      RETURNING id`,
    [row.employee_number, row.first_name, row.last_name, siteId, deactivatedAt],
  );

  return updated.rowCount === 1;
}

async function recordImport(
  client: PoolClient,
  batch: {
    importedBy: string | null;
    sourceFilename: string;
    rowsRead: number;
    rowsApplied: number;
    rowsRejected: number;
    startedAt: Date;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO roster_import
       (imported_by, source_filename, rows_read, rows_applied, rows_rejected, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      batch.importedBy,
      batch.sourceFilename,
      batch.rowsRead,
      batch.rowsApplied,
      batch.rowsRejected,
      batch.startedAt,
    ],
  );

  const [row] = result.rows;

  if (row === undefined) {
    throw new Error('El INSERT de roster_import no devolvió ninguna fila.');
  }

  return row.id;
}

/**
 * El desglose por planta. No es contabilidad decorativa: es la fila de la que el
 * trigger `roster_import_site_audit` deriva la entrada de auditoría de resumen de
 * cada sitio. Sin ella, `audit_log.site_id` —que es NOT NULL— no tendría de dónde
 * salir.
 *
 * Los rechazos se atribuyen a la planta cuando la fila la nombraba y era una que el
 * importador administra; los que no —número faltante, sitio desconocido— no
 * pertenecen a ninguna cadena y solo cuentan en el total del lote.
 */
async function recordSiteBreakdown(
  client: PoolClient,
  importId: string,
  appliedBySite: ReadonlyMap<string, number>,
  rejections: readonly RosterRejection[],
  parsed: ParsedRoster,
  sites: ReadonlyMap<string, string>,
): Promise<void> {
  const rejectedBySite = new Map<string, number>();

  for (const rejection of rejections) {
    const siteId = sites.get(parsed.rawByRow.get(rejection.row_number)?.site_code ?? '');

    if (siteId !== undefined) {
      rejectedBySite.set(siteId, (rejectedBySite.get(siteId) ?? 0) + 1);
    }
  }

  const touched = new Set([...appliedBySite.keys(), ...rejectedBySite.keys()]);

  for (const siteId of touched) {
    await client.query(
      `INSERT INTO roster_import_site (import_id, site_id, rows_applied, rows_rejected)
       VALUES ($1, $2, $3, $4)`,
      [importId, siteId, appliedBySite.get(siteId) ?? 0, rejectedBySite.get(siteId) ?? 0],
    );
  }
}

async function recordRejections(
  client: PoolClient,
  importId: string,
  rejections: readonly RosterRejection[],
  parsed: ParsedRoster,
): Promise<void> {
  // La fila cruda se guarda junto al rechazo: sin ella, "fila 47 rechazada por
  // sitio desconocido" obliga a volver al archivo original, que para entonces puede
  // haber cambiado.
  for (const rejection of rejections) {
    await client.query(
      `INSERT INTO roster_import_rejection (import_id, row_number, employee_number, reason, raw_row)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        importId,
        rejection.row_number,
        rejection.employee_number,
        rejection.reason,
        JSON.stringify(parsed.rawByRow.get(rejection.row_number) ?? {}),
      ],
    );
  }
}
