import { PgBoss } from 'pg-boss';
import pg from 'pg';

import { COORDINATOR_ID, issueInvitation } from './bootstrap-invitation.mjs';

/**
 * El estado mínimo para que un entorno local se pueda USAR: una cuenta que entra al
 * PWA y una inspección del período corriente asignada a ella.
 *
 * POR QUÉ NO ES UN SEED. `004_bootstrap_coordinator.sql` lo tiene escrito: "un seed que
 * sembrara una contraseña conocida sería una puerta abierta en cada entorno donde se
 * corran los seeds". `pnpm db:seed` corre en CI y en cualquier entorno; esto se corre a
 * mano, en la máquina de quien desarrolla, y por eso puede hacer lo que un seed no.
 *
 * POR QUÉ UN `jhsc_member` Y NO EL COORDINADOR SEMBRADO. `requireInspector()` rechaza
 * cualquier otro rol —§4: los 7 miembros del JHSC son los únicos que ejecutan
 * inspecciones—, así que es el único rol al que se le puede asignar una. Desbloquear al
 * coordinador le daría una cuenta que entra pero cuyo pendiente sigue vacío, que es
 * exactamente el estado del que este script existe para salir.
 *
 * Corre como `hs_app`, igual que `bootstrap-invitation.mjs`: los GRANT alcanzan
 * (`0005_identity.sql` concede INSERT sobre `person`, `app_user` y `user_site_scope`;
 * `0008_inspection_scheduling.sql` concede UPDATE sobre `inspector_id`), y que alcancen
 * es parte de lo que esto prueba.
 *
 * IDEMPOTENTE. Se corre las veces que haga falta: la segunda no duplica nada y no falla.
 */

// Ids literales fijos, por el mismo motivo que `002_sites.sql` y `004`: los comandos y
// las consultas a mano nombran la cuenta sin una subconsulta.
const INSPECTOR = {
  personId: '7e150000-0000-4000-8000-0000000000d1',
  accountId: 'acc00000-0000-4000-8000-0000000000d1',
  employeeNumber: 'DEMO-0001',
  firstName: 'Dana',
  lastName: 'Inspector',
  email: 'demo.inspector@example.com',
};

const ST_THOMAS = '5717e900-0000-4000-8000-000000000001';
const GLENCOE = '5717e900-0000-4000-8000-000000000002';

/** El roster de demo: gente SIN cuenta, que es el caso normal (§4). */
const ROSTER = [
  { employeeNumber: 'DEMO-1001', firstName: 'Alex', lastName: 'Boivin', siteId: ST_THOMAS },
  { employeeNumber: 'DEMO-1002', firstName: 'Priya', lastName: 'Raman', siteId: ST_THOMAS },
  { employeeNumber: 'DEMO-1003', firstName: 'Sam', lastName: 'Okafor', siteId: ST_THOMAS },
  { employeeNumber: 'DEMO-1004', firstName: 'Marie', lastName: 'Tremblay', siteId: GLENCOE },
  { employeeNumber: 'DEMO-1005', firstName: 'Chen', lastName: 'Wu', siteId: GLENCOE },
];

/** Igual que `SITE_TIME_ZONE` en `src/jobs/job-registry.ts`. */
const SITE_TIME_ZONE = 'America/Toronto';

const DEFAULT_PASSWORD = 'demo-inspector-2026';
const OPEN_PERIOD_JOB = 'inspections.open-period';
const OPEN_PERIOD_TIMEOUT_MS = 15_000;

/**
 * El primer día del mes en curso en Ontario. Misma regla que
 * `src/inspections/period.ts`: el período es una fecha civil, no un instante, y con
 * `Intl` porque el horario de verano mueve el offset dos veces al año.
 */
function currentPeriodStart(instant) {
  const civil = new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

  return `${civil.slice(0, 7)}-01`;
}

/**
 * La cuenta del inspector: persona, cuenta y alcance **en una sola transacción**.
 *
 * Que sea una sola no es comodidad. El trigger de alta de cuenta está diferido a COMMIT
 * justamente para encontrar el alcance ya otorgado; si el alcance se otorgara en otra
 * transacción, el alta no escribiría ninguna entrada de auditoría. Ver el comentario de
 * `hs_account_audit_fanout()` en la migración 0005.
 *
 * El alcance de sitio se declara ANTES de cualquier INSERT: `person` lleva
 * `hs_apply_site_isolation`, y sin la declaración el WITH CHECK rechaza con un error que
 * no menciona RLS por ningún lado.
 */
async function createInspector(pool) {
  // `app_user_email_key` es único. Si el email ya es de OTRA cuenta —una hecha a mano
  // antes de que este script existiera, por ejemplo— el INSERT falla con un error de
  // restricción que no dice qué hacer. Esto sí lo dice.
  const { rows: conflict } = await pool.query(
    'SELECT id FROM app_user WHERE email = $1 AND id <> $2',
    [INSPECTOR.email, INSPECTOR.accountId],
  );

  if (conflict[0]) {
    throw new Error(
      `El email ${INSPECTOR.email} ya es de la cuenta ${conflict[0].id}. Cambiá el email en ` +
        'este script o dá de baja esa cuenta.',
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    await client.query(
      `INSERT INTO person (id, employee_number, first_name, last_name, site_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_number) DO NOTHING`,
      [
        INSPECTOR.personId,
        INSPECTOR.employeeNumber,
        INSPECTOR.firstName,
        INSPECTOR.lastName,
        ST_THOMAS,
      ],
    );

    await client.query(
      `INSERT INTO app_user (id, person_id, email, role)
       VALUES ($1, $2, $3, 'jhsc_member')
       ON CONFLICT (id) DO NOTHING`,
      [INSPECTOR.accountId, INSPECTOR.personId, INSPECTOR.email],
    );

    await client.query(
      `INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [INSPECTOR.accountId, ST_THOMAS],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gente del roster, sin cuenta. Sin esto la planta tiene una sola persona —la del
 * coordinador— y las pantallas que piden atribuir a alguien no tienen entre quiénes
 * elegir.
 */
async function createRoster(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.site_ids',
      `${ST_THOMAS},${GLENCOE}`,
    ]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    for (const person of ROSTER) {
      await client.query(
        `INSERT INTO person (employee_number, first_name, last_name, site_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_number) DO NOTHING`,
        [person.employeeNumber, person.firstName, person.lastName, person.siteId],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * El inspector por defecto de la regla de St. Thomas, para que los períodos que se
 * abran de acá en más ya nazcan asignados y no haga falta volver a correr esto.
 */
async function setDefaultInspector(pool) {
  const client = await pool.connect();
  let updated;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    ({ rowCount: updated } = await client.query(
      `UPDATE inspection_schedule
          SET default_inspector_id = $1
        WHERE site_id = $2 AND deactivated_at IS NULL`,
      [INSPECTOR.accountId, ST_THOMAS],
    ));

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (updated === 0) {
    throw new Error(
      'No hay ninguna regla de inspección activa en St. Thomas. ¿Corriste `pnpm db:seed`?',
    );
  }
}

/**
 * Encola `inspections.open-period` y espera a que la API lo consuma.
 *
 * NO se duplica acá el INSERT de apertura. `OpenPeriodService` es la única vía, y es
 * idempotente por el único parcial `scheduled_inspection_open_period_uq`: encolarlo dos
 * veces no abre dos veces. Un segundo INSERT escrito a mano en este script se olvidaría
 * de congelar la versión de plantilla, de las notificaciones al coordinador, o de las
 * dos — y la divergencia se descubriría en producción.
 *
 * Requiere que la API esté corriendo: el planificador vive ahí, no acá.
 */
async function openPeriod(pool, periodStart) {
  // El camino corto: el período ya está abierto —lo abrió el cron, o una corrida
  // anterior de esto— y entonces no hace falta ni encolar ni que la API esté levantada.
  const existing = await findOpenInspection(pool, periodStart);
  if (existing) return existing;

  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: 'pgboss',
    max: 2,
  });

  // Un EventEmitter sin listener de `error` tumba el proceso. Mismo motivo que en
  // `src/jobs/jobs.service.ts`.
  boss.on('error', () => undefined);

  try {
    await boss.start();

    if (!(await boss.isInstalled())) {
      throw new Error(
        'El esquema `pgboss` no está instalado. Correr `pnpm db:jobs:install` antes de esto.',
      );
    }

    // La cola la declara la API al arrancar, no esto: `hs_app` tiene USAGE sobre el
    // esquema `pgboss` pero no CREATE. Si `send` no encuentra la cola, la causa es la
    // misma que si el trabajo no se consume — y es la que dice el error de abajo.
    await boss.send(OPEN_PERIOD_JOB, {});
  } catch {
    throw new Error(apiNotRunning(periodStart));
  } finally {
    await boss.stop({ graceful: false }).catch(() => undefined);
  }

  const deadline = Date.now() + OPEN_PERIOD_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const found = await findOpenInspection(pool, periodStart);
    if (found) return found;

    await new Promise((done) => setTimeout(done, 500));
  }

  throw new Error(apiNotRunning(periodStart));
}

/**
 * Bajo alcance declarado, y no con `pool.query` a secas: `scheduled_inspection` lleva
 * `hs_apply_site_isolation` con FORCE, así que sin `app.site_ids` la política no
 * devuelve nada — y "nada" acá se leería como "el trabajo no abrió el período", que es
 * un diagnóstico equivocado con la misma cara.
 */
async function findOpenInspection(pool, periodStart) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);

    const { rows } = await client.query(
      `SELECT id FROM scheduled_inspection
        WHERE site_id = $1 AND period_start = $2 AND cancelled_at IS NULL`,
      [ST_THOMAS, periodStart],
    );

    await client.query('COMMIT');

    return rows[0]?.id ?? null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const apiNotRunning = (periodStart) =>
  `El trabajo \`${OPEN_PERIOD_JOB}\` no abrió el período ${periodStart} en ` +
  `${OPEN_PERIOD_TIMEOUT_MS / 1000} s. El planificador vive en la API, no acá: arrancala ` +
  'con `pnpm --filter api start:dev` (y sin `JOBS_ENABLED=false`) y volvé a correr esto.';

/**
 * Asigna la inspección YA abierta, que nació con `inspector_id` NULL porque el default
 * de la regla se puso recién ahora.
 *
 * Va por SQL y no por `PATCH /scheduled-inspections/:id/inspector` porque ese endpoint
 * exige sesión de coordinador, que es exactamente lo que el segundo factor bloquea. El
 * `app.user_id` deja la reasignación con actor: el trigger escribe
 * `inspection.reassigned` con el anterior y el nuevo, y no hace falta escribirlo acá.
 */
async function assignInspector(pool, inspectionId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    await client.query(
      `UPDATE scheduled_inspection
          SET inspector_id = $2
        WHERE id = $1 AND inspector_id IS DISTINCT FROM $2`,
      [inspectionId, INSPECTOR.accountId],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * La credencial, por la misma puerta que cualquier alta: invitación y aceptación.
 *
 * `POST /auth/invitations/accept` es `@Public()` —quien acepta todavía no tiene forma de
 * tener una sesión—, así que no hace falta autenticarse para llegar. Si la cuenta ya
 * tiene credencial, `issueInvitation` corta y esto lo reporta como "ya está lista": es
 * la segunda corrida del script, no un error.
 */
async function ensureCredential(pool, apiBaseUrl, password) {
  let invitation;

  try {
    invitation = await issueInvitation(pool, INSPECTOR.accountId);
  } catch (error) {
    if (error.message.includes('ya tiene credencial')) return { alreadyHadCredential: true };
    throw error;
  }

  const response = await fetch(new URL('/auth/invitations/accept', apiBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: invitation.token, password }),
  });

  if (!response.ok) {
    throw new Error(
      `POST /auth/invitations/accept respondió ${response.status}: ${await response.text()}`,
    );
  }

  return { alreadyHadCredential: false };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('demo:data no corre con NODE_ENV=production. Siembra una contraseña conocida.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Ver .env.example.');
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const password = process.env.DEMO_PASSWORD ?? DEFAULT_PASSWORD;

  if (password.length < 12) {
    throw new Error('DEMO_PASSWORD tiene que tener al menos 12 caracteres (`passwordSchema`).');
  }

  const periodStart = currentPeriodStart(new Date());
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await createInspector(pool);
    await createRoster(pool);
    await setDefaultInspector(pool);

    const inspectionId = await openPeriod(pool, periodStart);

    await assignInspector(pool, inspectionId);

    const { alreadyHadCredential } = await ensureCredential(pool, apiBaseUrl, password);

    process.stdout.write(
      [
        '',
        'Entorno de demo listo.',
        '',
        `  email       ${INSPECTOR.email} (jhsc_member)`,
        alreadyHadCredential
          ? '  contraseña  la que se puso la primera vez que corrió esto'
          : `  contraseña  ${password}`,
        '  planta      St. Thomas',
        `  período     ${periodStart}`,
        `  inspección  ${inspectionId}`,
        '',
        'Con eso se entra al PWA y la inspección aparece en `/`.',
        '',
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error.message}\n`);
});
