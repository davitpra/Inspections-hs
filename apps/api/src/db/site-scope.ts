import type { Pool, PoolClient } from 'pg';

/**
 * El alcance que declara una transacción: qué sitios puede ver y quién actúa.
 */
export interface SiteScope {
  siteIds: readonly string[];
  userId?: string | null;
}

/**
 * ADR-002 — El aislamiento por sitio lo aplica la política RLS, no un `WHERE` en
 * el endpoint. Este helper es lo único que declara el alcance.
 *
 * `set_config(..., true)` es `SET LOCAL`: muere con la transacción. Un `SET` a
 * secas o una variable de sesión serían un bug de seguridad silencioso bajo
 * pooling — la conexión arrastraría el alcance de un request al siguiente.
 * Se usa `set_config` y no la sentencia `SET LOCAL` porque `SET` no acepta
 * parámetros y el valor tendría que interpolarse en el SQL.
 *
 * Con `siteIds` vacío no se fija nada: `current_setting(..., true)` devuelve NULL,
 * la política no matchea ninguna fila y la transacción no ve nada. Es el default
 * correcto y es deliberado — fijar la cadena vacía haría fallar el cast a uuid[]
 * con un error que no explica nada.
 */
export async function withSiteScope<T>(
  pool: Pool,
  scope: SiteScope,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (scope.siteIds.length > 0) {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.site_ids',
        scope.siteIds.join(','),
      ]);
    }

    if (scope.userId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', scope.userId]);
    }

    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
