import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * Aplica los seeds de `apps/api/seeds/` en orden de nombre.
 *
 * Corre como `hs_migrator`, no como `hs_app`: la migración 0003 le retira el
 * INSERT al rol de la aplicación sobre las tablas de plantilla. En v1 publica el
 * seed; la etapa 8 le concederá INSERT al builder.
 *
 * Cada archivo va en su propia transacción, así que un seed que falla no deja a
 * medias los que ya se aplicaron. Los seeds son idempotentes por contrato: se
 * corren las veces que haga falta.
 */

export const SEEDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../seeds');

/** Los `.sql` de `seeds/`, ordenados por nombre. */
export async function seedFiles() {
  const entries = await readdir(SEEDS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/**
 * Aplica todos los seeds sobre el cliente o pool dado. Devuelve los nombres
 * aplicados, para que el caller pueda reportarlos.
 */
export async function applySeeds(client) {
  const files = await seedFiles();

  for (const file of files) {
    const sql = await readFile(join(SEEDS_DIR, file), 'utf8');

    await client.query('BEGIN');

    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Falló el seed ${file}: ${error.message}`, { cause: error });
    }
  }

  return files;
}

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;

  if (!connectionString) {
    throw new Error('Falta MIGRATION_DATABASE_URL. Los seeds corren como hs_migrator.');
  }

  const pool = new pg.Pool({ connectionString });

  try {
    const applied = await applySeeds(pool);
    console.log(`Seeds aplicados: ${applied.join(', ') || '(ninguno)'}`);
  } finally {
    await pool.end();
  }
}

// Solo cuando se lo invoca como script, no cuando lo importa un test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
