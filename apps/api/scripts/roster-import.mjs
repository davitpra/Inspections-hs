import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * Importa el roster desde un CSV. §6 pregunta cerrada 3: manual y controlada,
 * nunca sincronización con ADP.
 *
 * Es un comando de servidor y no un endpoint, y eso es deliberado: sin
 * autenticación no hay coordinador autenticado a quien exigirle el rol, y un
 * endpoint de administración sin dueño es superficie regalada. El módulo importador
 * (`src/roster/`) está escrito para que el endpoint del change de auth lo llame sin
 * reescribir nada.
 *
 *   pnpm roster:import <archivo.csv> [--as <email de la cuenta>]
 *
 * Corre como hs_app —el rol de la API— y no como hs_migrator: la importación es una
 * operación de aplicación, y si necesitara privilegios de migración sería la señal
 * de que algo del mecanismo está mal puesto.
 */

const USAGE = 'Uso: pnpm roster:import <archivo.csv> [--as <email>]';

function parseArgs(argv) {
  const [file, ...rest] = argv;

  if (!file) {
    throw new Error(USAGE);
  }

  let as = null;

  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--as') {
      as = rest[i + 1] ?? null;
      i += 1;
    } else {
      throw new Error(`Argumento desconocido: ${rest[i]}\n${USAGE}`);
    }
  }

  return { file, as };
}

/**
 * La cuenta que importa y su alcance vigente. Es lo que va a hacer el endpoint con
 * la sesión; acá se resuelve por email porque no hay sesión todavía.
 */
async function resolveImporter(pool, email) {
  const account = await pool.query(
    `SELECT u.id, u.role, hs_account_is_active(u.*) AS active
       FROM app_user u
      WHERE u.email = lower($1)`,
    [email],
  );

  if (account.rowCount === 0) {
    throw new Error(`No existe una cuenta con el email ${email}.`);
  }

  const { id, role, active } = account.rows[0];

  if (!active) {
    throw new Error(`La cuenta ${email} está dada de baja o vencida.`);
  }

  // El roster lo administra el coordinador de HS (§4, tabla de roles). Es la única
  // verificación de rol del comando, y va acá y no en el módulo porque el módulo lo
  // va a llamar un endpoint que ya autorizó.
  if (role !== 'hs_coordinator') {
    throw new Error(`La cuenta ${email} tiene rol ${role}: el roster lo administra hs_coordinator.`);
  }

  const scope = await pool.query(
    'SELECT site_id FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL',
    [id],
  );

  if (scope.rowCount === 0) {
    throw new Error(`La cuenta ${email} no tiene ningún sitio en su alcance vigente.`);
  }

  return { userId: id, siteIds: scope.rows.map((row) => row.site_id) };
}

/** El reporte, legible. Es lo que el coordinador va a leer para arreglar el archivo. */
function printReport(report) {
  console.log(`\nArchivo:    ${report.source_filename}`);
  console.log(`Leídas:     ${report.rows_read}`);
  console.log(`Aplicadas:  ${report.rows_applied}`);
  console.log(`Rechazadas: ${report.rows_rejected}`);

  if (report.rejections.length === 0) {
    return;
  }

  console.log('\nFilas rechazadas:');

  for (const rejection of [...report.rejections].sort((a, b) => a.row_number - b.row_number)) {
    const who = rejection.employee_number ? ` (${rejection.employee_number})` : '';
    console.log(`  fila ${rejection.row_number}${who}: ${rejection.reason}`);
  }

  console.log('\nEl resto del archivo SÍ se aplicó. Corregí estas filas y volvé a importar.');
}

async function main() {
  const { file, as } = parseArgs(process.argv.slice(2));

  if (!as) {
    throw new Error(`Falta --as <email>: la importación tiene que quedar atribuida.\n${USAGE}`);
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Falta DATABASE_URL.');
  }

  // El importador vive en TypeScript compilado: el comando se corre después de
  // `pnpm --filter api build`, igual que la API.
  const { parseRosterCsv } = await import('../dist/roster/parse-roster-csv.js');
  const { applyRoster } = await import('../dist/roster/apply-roster.js');

  const text = await readFile(resolve(file), 'utf8');
  const pool = new pg.Pool({ connectionString });

  try {
    const scope = await resolveImporter(pool, as);
    const parsed = parseRosterCsv(text);
    const report = await applyRoster(pool, parsed, scope, { sourceFilename: basename(file) });

    printReport(report);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
