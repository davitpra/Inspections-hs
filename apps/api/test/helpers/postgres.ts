import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Se busca la raíz del workspace en vez de resolver contra `process.cwd()`:
 * `import.meta.url` no está disponible (apps/api compila a CommonJS) y el cwd
 * depende de desde dónde se invoque Vitest.
 */
function repoRoot(): string {
  let current = process.cwd();

  while (!existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
    const parent = dirname(current);

    if (parent === current) {
      throw new Error('No se encontró la raíz del workspace (pnpm-workspace.yaml).');
    }

    current = parent;
  }

  return current;
}

const ROOT = repoRoot();

/**
 * El contenedor monta **el mismo** `db/init/01-roles.sql` que usa
 * `docker-compose.yml`. Un test contra roles definidos aparte probaría roles que
 * no existen en ningún lado.
 */
const ROLES_SQL = resolve(ROOT, 'db/init/01-roles.sql');
const MIGRATIONS_DIR = resolve(ROOT, 'apps/api/drizzle');

const DATABASE = 'hs_platform';

export interface TestDatabase {
  /** Rol de runtime: sin CREATE, sin UPDATE/DELETE. Es el rol de la API. */
  app: Pool;
  /** Rol de migraciones: dueño del schema. Solo para probar la segunda barrera. */
  migrator: Pool;
  /** Superusuario. Solo para simular manipulación fuera de banda del log. */
  superuser: Pool;
  /**
   * Pool de `hs_app` con una sola conexión física. Es lo que permite probar que
   * el alcance de sitio no se filtra entre transacciones: con `max: 1` la segunda
   * transacción usa por fuerza la misma conexión que la primera.
   */
  singleConnectionApp: () => Pool;
  /**
   * La URL de `hs_app` contra este contenedor. La usan los tests que construyen los
   * servicios reales de la API —que leen `DATABASE_URL`— en vez de hablarle a la base
   * directamente.
   */
  appUrl: string;
  stop: () => Promise<void>;
}

/**
 * Levanta un Postgres 17 con los roles reales del proyecto y las migraciones
 * aplicadas como `hs_migrator`, y devuelve un pool por rol.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withCopyFilesToContainer([
      { source: ROLES_SQL, target: '/docker-entrypoint-initdb.d/01-roles.sql' },
    ])
    .start();

  const host = container.getHost();
  const port = container.getPort();

  const poolFor = (user: string, password: string, max = 4) =>
    new Pool({ host, port, database: DATABASE, user, password, max });

  const migrator = poolFor('hs_migrator', 'hs_migrator_dev');
  const app = poolFor('hs_app', 'hs_app_dev');
  const superuser = poolFor('postgres', 'postgres');
  const extraPools: Pool[] = [];

  // Las migraciones corren como hs_migrator, igual que en cualquier entorno: si
  // corrieran como superusuario, los objetos quedarían con otro dueño y la mitad
  // de lo que estos tests prueban dejaría de aplicar.
  await migrate(drizzle(migrator), { migrationsFolder: MIGRATIONS_DIR });

  return {
    app,
    migrator,
    superuser,
    appUrl: `postgresql://hs_app:hs_app_dev@${host}:${port}/${DATABASE}`,
    singleConnectionApp: () => {
      const pool = poolFor('hs_app', 'hs_app_dev', 1);
      extraPools.push(pool);
      return pool;
    },
    stop: async () => {
      await Promise.all([app.end(), migrator.end(), superuser.end(), ...extraPools.map((p) => p.end())]);
      await container.stop();
    },
  };
}

/** Corre una sentencia con el alcance de sitio declarado, y devuelve las filas. */
export async function inScope<T extends Record<string, unknown>>(
  pool: Pool,
  siteIds: readonly string[],
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (siteIds.length > 0) {
      await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', siteIds.join(',')]);
    }

    const result = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** La única fila del resultado. Falla ruidosamente si no hay ninguna. */
export function one<T>(rows: readonly T[]): T {
  const [row] = rows;

  if (row === undefined) {
    throw new Error('La consulta no devolvió ninguna fila.');
  }

  return row;
}

/** El SQLSTATE de un error de `pg`, para no comparar contra el texto del mensaje. */
export function sqlstate(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

/** Inserta un evento y devuelve la fila tal como quedó almacenada. */
export async function insertEvent(
  pool: Pool,
  siteId: string,
  event: {
    eventType?: string;
    payload?: unknown;
    occurredAt?: Date | string;
    /** Valores que el caller no debería poder imponer. Se mandan para probarlo. */
    forged?: { recordedAt?: string; hash?: Buffer; prevHash?: Buffer };
  } = {},
): Promise<AuditRow> {
  const rows = await inScope<AuditRow>(
    pool,
    [siteId],
    `INSERT INTO audit_log
       (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash, prev_hash)
     VALUES ($1, NULL, $2, $3::jsonb, $4, $5, $6, $7)
     RETURNING id, site_id, seq, event_type, payload, occurred_at, recorded_at, hash, prev_hash`,
    [
      siteId,
      event.eventType ?? 'test.event',
      JSON.stringify(event.payload ?? { note: 'test' }),
      event.occurredAt ?? new Date(),
      event.forged?.recordedAt ?? new Date(),
      event.forged?.hash ?? Buffer.alloc(32),
      event.forged?.prevHash ?? null,
    ],
  );

  return one(rows);
}

export interface AuditRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  seq: string;
  event_type: string;
  payload: unknown;
  occurred_at: Date;
  recorded_at: Date;
  hash: Buffer;
  prev_hash: Buffer | null;
}
