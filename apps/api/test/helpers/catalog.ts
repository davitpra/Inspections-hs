import type { Pool } from 'pg';

import { inScope, one } from './postgres';

/**
 * Helpers del catálogo para los tests de integración.
 *
 * `site` no lleva política RLS —es dato de referencia de la organización— así que
 * se escribe sin declarar alcance. `location` sí la lleva: todo lo que la toque
 * declara el sitio, igual que lo hará cualquier request.
 */

/**
 * Los ids de los dos sitios sembrados por `seeds/002_sites.sql`. Los tests que
 * corren los seeds los usan sin buscarlos: para eso los ids son fijos.
 */
export const SEEDED_SITES = {
  stThomas: '5717e900-0000-4000-8000-000000000001',
  glencoe: '5717e900-0000-4000-8000-000000000002',
} as const;

/**
 * Registra un sitio con un id dado.
 *
 * Desde `0004` toda entrada de `audit_log` referencia una fila de `site`, así que
 * los specs que escriben eventos tienen que registrar sus sitios primero. Es
 * idempotente para que un spec pueda llamarlo sin coordinar con los demás.
 */
export async function registerSite(
  pool: Pool,
  id: string,
  code: string,
  name = code,
): Promise<string> {
  await inScope(pool, [], 'INSERT INTO site (id, code, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [
    id,
    code,
    name,
  ]);

  return id;
}

/** Da de alta una ubicación y devuelve su id. */
export async function createLocation(
  pool: Pool,
  siteId: string,
  code: string,
  name: string,
): Promise<string> {
  const rows = await inScope<{ id: string }>(
    pool,
    [siteId],
    'INSERT INTO location (site_id, code, name) VALUES ($1, $2, $3) RETURNING id',
    [siteId, code, name],
  );

  return one(rows).id;
}

export interface LocationRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  code: string;
  name: string;
  deactivated_at: Date | null;
}

/** Una ubicación por id, dentro del alcance dado. */
export async function locationById(
  pool: Pool,
  siteIds: readonly string[],
  id: string,
): Promise<LocationRow> {
  const rows = await inScope<LocationRow>(
    pool,
    siteIds,
    'SELECT id, site_id, code, name, deactivated_at FROM location WHERE id = $1',
    [id],
  );

  return one(rows);
}

/**
 * El desplegable: las activas de los sitios del alcance, en orden alfabético. Es
 * la consulta que va a hacer la pantalla, escrita una sola vez.
 */
export async function selectableLocations(
  pool: Pool,
  siteIds: readonly string[],
): Promise<LocationRow[]> {
  return inScope<LocationRow>(
    pool,
    siteIds,
    `SELECT id, site_id, code, name, deactivated_at
       FROM location
      WHERE deactivated_at IS NULL
      ORDER BY name`,
  );
}
