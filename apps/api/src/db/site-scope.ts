import type { Pool, PoolClient } from 'pg';

/**
 * El alcance que declara una transacción: qué sitios puede ver y quién actúa.
 *
 * Esta es la entrada EXPLÍCITA, y desde ADR-011 es la de los seeds, las migraciones,
 * los comandos de servidor y los tests: cosas que no tienen una sesión detrás. El
 * camino HTTP usa `SessionScope` y no puede construir uno de estos, que es la forma
 * de que ningún endpoint pueda declarar un alcance que no le corresponde.
 */
export interface SiteScope {
  siteIds: readonly string[];
  userId?: string | null;
}

/**
 * El alcance derivado de una sesión (design D4). Lo produce el guard resolviendo el
 * token, y es lo único que el camino HTTP puede pasar.
 *
 * `siteIds` sale de `user_site_scope` en CADA request y no del token: por eso
 * revocarle una planta a alguien vale en el request siguiente y no cuando expira su
 * token.
 */
export interface SessionScope {
  userId: string;
  siteIds: readonly string[];
  role: string;
}

/**
 * ADR-002 — El aislamiento por sitio lo aplica la política RLS, no un `WHERE` en el
 * endpoint. Este helper es lo único que declara el alcance.
 *
 * `set_config(..., true)` es `SET LOCAL`: muere con la transacción. Un `SET` a secas
 * o una variable de sesión serían un bug de seguridad silencioso bajo pooling — la
 * conexión arrastraría el alcance de un request al siguiente. Se usa `set_config` y
 * no la sentencia `SET LOCAL` porque `SET` no acepta parámetros y el valor tendría
 * que interpolarse en el SQL.
 *
 * Con `siteIds` vacío no se fija nada: `current_setting(..., true)` devuelve NULL, la
 * política no matchea ninguna fila y la transacción no ve nada. Es el default
 * correcto y es deliberado — fijar la cadena vacía haría fallar el cast a uuid[] con
 * un error que no explica nada.
 */
export async function withSiteScope<T>(
  pool: Pool,
  scope: SiteScope,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  // Sin rol: `SiteScope` es el camino de los seeds, las migraciones y los comandos de
  // servidor, que no tienen una sesión detrás. Ver el comentario de `app.role` abajo.
  return runScoped(pool, scope.siteIds, scope.userId ?? null, null, run);
}

/**
 * ADR-011 — La misma transacción, pero con el alcance derivado de quién inició
 * sesión en vez de declarado por el llamador.
 *
 * Además del alcance y el actor, declara el rol que consultan las políticas de
 * visibilidad. Las lecturas de los tres roles siguen la regla general: no se registran.
 */
export async function withSessionScope<T>(
  pool: Pool,
  session: SessionScope,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runScoped(pool, session.siteIds, session.userId, session.role, run);
}

async function runScoped<T>(
  pool: Pool,
  siteIds: readonly string[],
  userId: string | null,
  role: string | null,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (siteIds.length > 0) {
      await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', siteIds.join(',')]);
    }

    if (userId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    }

    // El ROL en la conexión (0012, design D3). La política `RESTRICTIVE` de `incident`
    // no alcanza con `site_id`: necesita distinguir al coordinador y a gerencia —que
    // ven todos los incidentes de su alcance— del miembro del JHSC, que queda sujeto
    // a la rama restringida de la política.
    //
    // Con `true` como en las otras tres: muere con la transacción, así que una conexión
    // devuelta al pool no arrastra el rol al request siguiente.
    //
    // SIN ROL NO SE VE NINGÚN INCIDENTE, y ese es el default correcto: un alcance
    // explícito de seed o de migración no declara rol, y el modo de falla cerrado hace
    // que un olvido se manifieste como "no veo nada" —que se investiga— y no como "veo
    // de más", que no se nota.
    if (role) {
      await client.query('SELECT set_config($1, $2, true)', ['app.role', role]);
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
