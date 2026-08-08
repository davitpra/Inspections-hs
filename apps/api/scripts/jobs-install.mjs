import pg from 'pg';
import { getConstructionPlans, getMigrationPlans } from 'pg-boss';

/**
 * Instala o actualiza el esquema `pgboss`, como `hs_migrator`.
 *
 * ES UN PASO DE DESPLIEGUE, al lado de `pnpm db:migrate`, y no parte del arranque de
 * la API. Dos razones que apuntan al mismo lugar:
 *
 *   1. `apps/api/src/db/db.service.ts` tiene escrito que `MIGRATION_DATABASE_URL`
 *      nunca entra al proceso de la API. Traer una conexión de dueño para instalar
 *      una vez lo violaría por comodidad, y un proceso de larga vida conectado con el
 *      rol dueño evade toda política RLS por la vía de FORCE.
 *   2. pg-boss 12 no tiene opción `migrate` en el constructor. Expone el SQL del plan
 *      de construcción para correrlo donde corresponda, que es acá.
 *
 * El orden importa y no es reversible: `0008_inspection_scheduling.sql` fija los
 * ALTER DEFAULT PRIVILEGES del esquema ANTES de que existan estas tablas, porque los
 * default privileges no son retroactivos. Correr este script contra una base sin la
 * migración 0008 deja un esquema que hs_app no puede tocar, y el síntoma es un worker
 * que arranca y no consume nunca.
 *
 * IDEMPOTENTE: sobre un esquema ya instalado aplica solo las migraciones internas que
 * falten, y sobre uno al día no hace nada.
 */

const SCHEMA = 'pgboss';

/** La versión interna del esquema, o `null` si todavía no está instalado. */
async function installedVersion(client) {
  const { rows } = await client.query(
    `SELECT version FROM ${SCHEMA}.version LIMIT 1`,
  );

  return rows[0]?.version ?? null;
}

export async function installJobSchema(client) {
  let current = null;

  try {
    current = await installedVersion(client);
  } catch (error) {
    // 42P01 (undefined_table) y 3F000 (invalid_schema_name) son "todavía no está
    // instalado", que es un estado esperado. Cualquier otro error —permisos, red— se
    // propaga: tragárselos convertiría un problema de conexión en una reinstalación.
    if (error.code !== '42P01' && error.code !== '3F000') throw error;
  }

  if (current === null) {
    await client.query(getConstructionPlans(SCHEMA));
    return { action: 'installed' };
  }

  const plans = getMigrationPlans(SCHEMA, Number(current));

  if (!plans.trim()) return { action: 'up-to-date', version: current };

  await client.query(plans);
  return { action: 'migrated', from: current };
}

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;

  if (!connectionString) {
    throw new Error('Falta MIGRATION_DATABASE_URL. El esquema de trabajos lo crea hs_migrator.');
  }

  const pool = new pg.Pool({ connectionString });

  try {
    const result = await installJobSchema(pool);
    console.log(`Esquema \`${SCHEMA}\`: ${result.action}.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('jobs-install.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
