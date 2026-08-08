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
  /** Solo para `external_auditor`, y obligatoria para ese rol. */
  recordsFrom?: string | null;
  recordsTo?: string | null;
}

/**
 * Qué se está leyendo. Solo lo consume el registro de lecturas del auditor externo
 * (design D10); para cualquier otro rol se ignora, porque este sistema no loguea
 * lecturas y esa es la regla que la excepción del auditor confirma.
 */
export interface ReadDescriptor {
  /** El tipo de registro leído: `finding`, `inspection`, `audit_log`… */
  resource: string;
  /**
   * De qué filas se trató. El default alcanza para el caso normal —una lista de
   * filas con `id` y `site_id`—, y existe la vía explícita para cuando no lo es.
   */
  identify?: (result: unknown) => ReadFootprint[];
}

/** Una fila leída, reducida a lo que el log necesita: de qué sitio es y cuál era. */
export interface ReadFootprint {
  siteId: string;
  id: string | number;
}

const HAS_ID_AND_SITE = (row: unknown): row is { id: string | number; site_id?: string; siteId?: string } =>
  typeof row === 'object' && row !== null && 'id' in row;

/**
 * El default: si el resultado es una lista de filas con `id` y `site_id`/`siteId`,
 * se registran esas. Si no lo es, se registra que la lectura ocurrió y no qué
 * devolvió — que sigue siendo el hecho que el registro tiene que probar.
 */
function defaultFootprint(result: unknown): ReadFootprint[] {
  if (!Array.isArray(result)) return [];

  return result.flatMap((row) => {
    if (!HAS_ID_AND_SITE(row)) return [];
    const siteId = row.site_id ?? row.siteId;
    return siteId ? [{ siteId, id: row.id }] : [];
  });
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
  return runScoped(pool, scope.siteIds, scope.userId ?? null, null, null, run);
}

/**
 * ADR-011 — La misma transacción, pero con el alcance derivado de quién inició
 * sesión en vez de declarado por el llamador.
 *
 * Hace dos cosas más que `withSiteScope`:
 *
 * 1. Para un `external_auditor`, fija `app.records_from`/`app.records_to`, que es lo
 *    que activa la política `hs_apply_record_window`. Para cualquier otro rol no fija
 *    nada y la política no acota: el default de una ventana es toda la historia.
 * 2. Para un `external_auditor`, escribe la entrada de lectura ANTES de cometer. Es
 *    la única excepción del sistema a no loguear lecturas (riesgo I de §5), y va acá
 *    y no en un interceptor porque el requisito exige que una lectura cometida sin su
 *    entrada sea un estado inalcanzable. Un endpoint futuro hereda el comportamiento
 *    por usar este helper, que es la única vía por la que se toca la base.
 *
 * LA TENSIÓN, DECLARADA: el auditor es de solo lectura y sin embargo su transacción
 * escribe en `audit_log`. El motor no puede distinguirlo —`hs_app` tiene INSERT en
 * `audit_log` para todos—, así que "el auditor no escribe registros de dominio" lo
 * aplica el guard y no la base. Es la única regla de este change que no está forzada
 * por el motor.
 */
export async function withSessionScope<T>(
  pool: Pool,
  session: SessionScope,
  run: (client: PoolClient) => Promise<T>,
  read?: ReadDescriptor,
): Promise<T> {
  const isAuditor = session.role === 'external_auditor';

  return runScoped(
    pool,
    session.siteIds,
    session.userId,
    isAuditor ? (session.recordsFrom ?? null) : null,
    isAuditor ? (session.recordsTo ?? null) : null,
    async (client) => {
      const result = await run(client);

      if (isAuditor && read) {
        // La ventana se LIMPIA antes de escribir, y no es un detalle: el trigger de
        // la cadena de 0002 calcula `seq` con un `SELECT max(seq)` que la política de
        // ventana también filtra. Con una ventana de 2020 puesta vería cero filas,
        // asignaría `seq = 1` y chocaría contra el único `(site_id, seq)`.
        //
        // Limpiarla es además lo correcto conceptualmente: la ventana acota lo que el
        // auditor puede LEER, y la entrada que registra esa lectura no es una lectura.
        await client.query("SELECT set_config('app.records_from', '', true)");
        await client.query("SELECT set_config('app.records_to', '', true)");

        await recordAuditorRead(client, session, read, result);
      }

      return result;
    },
  );
}

async function recordAuditorRead(
  client: PoolClient,
  session: SessionScope,
  read: ReadDescriptor,
  result: unknown,
): Promise<void> {
  const footprint = (read.identify ?? defaultFootprint)(result);

  // Una lectura que no devolvió nada TAMBIÉN se registra: que el auditor haya
  // mirado es el hecho, y "miró y no había nada" es una respuesta que el registro
  // tiene que poder dar. Sin sitios en la huella se escribe en cada sitio del
  // alcance de la sesión, que es donde la lectura pudo haber alcanzado.
  const bySite = new Map<string, (string | number)[]>();

  for (const site of session.siteIds) bySite.set(site, []);
  for (const { siteId, id } of footprint) {
    bySite.set(siteId, [...(bySite.get(siteId) ?? []), id]);
  }

  for (const [siteId, ids] of bySite) {
    await client.query('SELECT hs_auditor_read_event($1::uuid, $2::jsonb)', [
      siteId,
      JSON.stringify({
        resource: read.resource,
        record_ids: ids,
        record_count: ids.length,
        records_from: session.recordsFrom ?? null,
        records_to: session.recordsTo ?? null,
      }),
    ]);
  }
}

async function runScoped<T>(
  pool: Pool,
  siteIds: readonly string[],
  userId: string | null,
  recordsFrom: string | null,
  recordsTo: string | null,
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

    if (recordsFrom) {
      await client.query('SELECT set_config($1, $2, true)', ['app.records_from', recordsFrom]);
    }

    if (recordsTo) {
      await client.query('SELECT set_config($1, $2, true)', ['app.records_to', recordsTo]);
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
