import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * ADR-011 — Crear la cuenta: el paso ANTERIOR a invitar, y el último del alta que
 * todavía se hacía en `psql`.
 *
 * Emitir la invitación ya tiene comando (`auth:bootstrap`) y aceptarla ya tiene pantalla
 * (`/accept-invitation`). Faltaba esto, y no por olvido: el SQL del alta no es una línea.
 * Los dos INSERT van en LA MISMA transacción con `app.site_ids` y `app.user_id` ya
 * declarados, porque `hs_account_audit_fanout()` (0005 §8) está diferido a COMMIT
 * justamente para encontrar el alcance otorgado. Hecho en dos transacciones el alta
 * funciona igual pero NO escribe auditoría; con una planta fuera del alcance declarado
 * frena con HS002 sin decir de quién ni de qué planta habla. Ese orden es toda la
 * corrección de este comando, y por eso vive acá y no en el README.
 *
 * EL `INSERT` EN SÍ —`insertAccount`— SE IMPORTA DE `dist/auth/account.repository.js`
 * (design D6) y no se reescribe acá: es el mismo orden que usa `POST /accounts`, y dos
 * implementaciones de ese orden es exactamente cómo una de las dos deja de escribir
 * auditoría sin que nadie se entere. Es la única razón por la que este script —que por
 * lo demás no tiene build ni runtime de TypeScript— depende de `pnpm --filter api build`
 * antes de correr. Lo que SÍ se queda acá, sin compartir: el chequeo de rol, el de
 * conflicto y sus mensajes, porque responden a una terminal y no a una respuesta HTTP.
 *
 * CORRE EN PRODUCCIÓN. La regla detrás de la única negativa que existe —la de
 * `auth:reset-password`— no es "los comandos no corren en producción": es que ese comando
 * REEMPLAZA una credencial, y ahí esa operación ya tiene dueño y no es una terminal (la
 * revoca el coordinador con `POST /auth/credentials/revoke`, y el bloqueo por intentos se
 * espera). Este no toca `app_credential`:
 * la cuenta que crea no puede iniciar sesión —nace sin credencial y sigue necesitando la
 * invitación emitida y aceptada— así que lo peor que puede hacer quien lo corre es crear
 * una cuenta de más, visible, auditada y desactivable. Negarse en producción habría
 * dejado el alta REAL, la única que importa, en el mismo `psql` que este comando saca.
 *
 * `auth:bootstrap` TAMPOCO SE NIEGA, y eso no es un olvido: emite la PRIMERA invitación,
 * la única que no puede venir de una sesión administrativa porque todavía no existe
 * ninguna. `POST /auth/invitations` exige esa sesión. Si el comando se negara en el
 * entorno de producción, la primera credencial del sistema no tendría cómo emitirse: es
 * exactamente el huevo y la gallina que ese script existe para romper (ADR-011, y el
 * encabezado de `bootstrap-invitation.mjs`). No le agregues la guarda.
 *
 * NO CREA PERSONAS. Si no está en el roster, entra por `pnpm roster:import`: crear
 * personas por un atajo del alta es exactamente cómo el roster deja de ser el roster.
 *
 * Corre como `hs_app` y no como `hs_migrator`, igual que `bootstrap-invitation.mjs`: es
 * una escritura de aplicación, y que el rol restringido alcance para hacerla es parte de
 * lo que prueba que la tabla está bien concedida (0005 §GRANT).
 *
 *   pnpm auth:create-account --employee ADP-1234 --email nombre@example.com \
 *     --role inspector --site st-thomas --actor coordinator@example.com
 */

/** Los tres roles admitidos por la plataforma (ADR-022). */
const INTERNAL_ROLES = ['coordinator', 'inspector', 'management'];

/** Los roles que normalmente llevan UNA planta (§6, pregunta cerrada 5). */
const SINGLE_SITE_ROLES = ['inspector'];

const USAGE = [
  'Uso: pnpm auth:create-account --employee <employeeNumber> --email <email>',
  '                             --role <rol> --site <code> [--site <code>] --actor <email|userId>',
  '',
  `  --role    ${INTERNAL_ROLES.join(' | ')}`,
  '  --site    code de la planta (st-thomas, glencoe). Repetible.',
  '  --actor   la cuenta en cuyo nombre se da el alta. Va a la cadena de auditoría.',
].join('\n');

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * `insertAccount` compilado: el mismo orden de INSERT que usa `POST /accounts` (ver la
 * cabecera). Se importa perezosamente y no arriba del archivo para poder dar un mensaje
 * legible cuando falta el build, en vez del `ERR_MODULE_NOT_FOUND` crudo de Node.
 */
async function loadInsertAccount() {
  const distPath = fileURLToPath(new URL('../dist/auth/account.repository.js', import.meta.url));

  try {
    return (await import(distPath)).insertAccount;
  } catch (error) {
    throw new Error(
      `No se encontró ${distPath}. Este comando reusa el INSERT de POST /accounts (design D6) ` +
        'compilado en dist/, así que hace falta compilar la API primero:\n\n' +
        '  pnpm --filter api build\n\n' +
        `(${error.message})`,
    );
  }
}

/**
 * `process.argv` a mano, como el resto de los comandos del repo. `--site` es el único
 * repetible.
 */
function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return null;

  const values = { site: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (!flag.startsWith('--')) throw new Error(`Argumento suelto: ${flag}\n\n${USAGE}`);

    const value = argv[index + 1];

    if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${flag}\n\n${USAGE}`);

    if (flag === '--site') values.site.push(value);
    else values[flag.slice(2)] = value;

    index += 1;
  }

  for (const required of ['employee', 'email', 'role', 'actor']) {
    if (!values[required]) throw new Error(`Falta --${required}\n\n${USAGE}`);
  }

  if (values.site.length === 0) throw new Error(`Falta --site\n\n${USAGE}`);

  if (!INTERNAL_ROLES.includes(values.role)) {
    throw new Error(`Rol inválido: ${values.role}. Los válidos son ${INTERNAL_ROLES.join(', ')}.`);
  }

  return {
    employeeNumber: values.employee,
    email: values.email.trim().toLowerCase(),
    role: values.role,
    siteCodes: [...new Set(values.site)],
    actor: values.actor,
  };
}

/**
 * El actor de las entradas de auditoría, y sus plantas.
 *
 * Es obligatorio y no tiene default. El alta escribe en la cadena de cada planta y esa
 * entrada nombra a una persona: resolverlo por descarte —"el único coordinador activo"—
 * dejaría el actor de un registro inmutable decidido por omisión, y cambiaría solo el día
 * que haya dos coordinadores.
 *
 * `app_user`, `user_site_scope` y `site` no están aisladas por sitio, así que esta
 * consulta sí puede correr sin alcance declarado. `person` no — ver `asActor`.
 */
async function findActor(pool, target) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role,
            coalesce(
              array_agg(s.code ORDER BY s.code) FILTER (WHERE s.code IS NOT NULL),
              '{}') AS site_codes,
            coalesce(
              array_agg(s.id::text ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL),
              '{}') AS site_ids
       FROM app_user u
       LEFT JOIN user_site_scope us ON us.user_id = u.id AND us.revoked_at IS NULL
       LEFT JOIN site s ON s.id = us.site_id
      WHERE ${isUuid(target) ? 'u.id = $1' : 'u.email = lower($1)'} AND u.deactivated_at IS NULL
      GROUP BY u.id`,
    [target],
  );

  if (!rows[0]) throw new Error(`No existe una cuenta activa para --actor ${target}.`);

  return rows[0];
}

/**
 * Todo lo que toca `person` o escribe la cuenta, bajo el alcance DEL ACTOR.
 *
 * Es el mismo criterio que `src/auth/account-scope.ts` —el único lugar del servidor donde
 * se administra una cuenta— y se declara el alcance del actor y no el de la cuenta
 * administrada a propósito: así `HS002` se vuelve una regla de permisos gratis, sin un
 * `if` que alguien pueda olvidarse de escribir.
 *
 * Hace falta también para LEER. `person` lleva `hs_apply_site_isolation` con FORCE ROW
 * LEVEL SECURITY, que alcanza a `hs_app`: sin alcance declarado la tabla se ve vacía, y
 * buscar a alguien por su número de empleado devuelve "no existe" para todo el mundo.
 */
async function asActor(pool, actor, run) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.site_ids',
      actor.site_ids.join(','),
    ]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', actor.id]);

    const result = await run(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Las plantas por `code`, comprobando que el actor las tenga TODAS.
 *
 * No es redundante con HS002. El trigger frena igual, pero lo hace en COMMIT y con un
 * SQLSTATE que no nombra ni al actor ni a la planta. Acá el alta ni siquiera empieza.
 */
async function resolveSites(pool, siteCodes, actor) {
  const { rows } = await pool.query(
    `SELECT id, code FROM site WHERE code = ANY($1::text[])`,
    [siteCodes],
  );

  const unknown = siteCodes.filter((code) => !rows.some((row) => row.code === code));

  if (unknown.length > 0) {
    const { rows: all } = await pool.query('SELECT code FROM site ORDER BY code');

    throw new Error(
      `No existe la planta ${unknown.join(', ')}. Las que hay: ${all.map((s) => s.code).join(', ')}.`,
    );
  }

  const outside = siteCodes.filter((code) => !actor.site_codes.includes(code));

  if (outside.length > 0) {
    throw new Error(
      `${actor.email} no tiene ${outside.join(', ')} en su alcance, así que no puede dar de alta ` +
        `a nadie ahí. Su alcance es ${actor.site_codes.join(', ') || '(vacío)'}.`,
    );
  }

  return rows;
}

/**
 * La persona del roster. No se crea acá: si no está, entra por `roster:import`.
 *
 * Corre bajo el alcance del actor, así que "no existe" acá significa "no existe en
 * ninguna de las plantas del actor" — que es la respuesta correcta y la única que se le
 * puede dar sin romper el aislamiento.
 */
async function findPerson(client, employeeNumber) {
  const { rows } = await client.query(
    `SELECT p.id, p.first_name, p.last_name, p.deactivated_at, s.code AS site_code,
            u.id AS account_id, u.email AS account_email, u.role AS account_role
       FROM person p
       JOIN site s ON s.id = p.site_id
       LEFT JOIN app_user u ON u.person_id = p.id
      WHERE p.employee_number = $1`,
    [employeeNumber],
  );

  if (!rows[0]) {
    throw new Error(
      `No hay ninguna persona con employee_number ${employeeNumber}. El roster se carga con ` +
        '`pnpm roster:import <csv>`; este comando no crea personas.',
    );
  }

  if (rows[0].deactivated_at) {
    throw new Error(
      `${employeeNumber} está dada de baja desde ${new Date(rows[0].deactivated_at).toISOString()}. ` +
        'Una persona inactiva no recibe cuenta.',
    );
  }

  return rows[0];
}

/**
 * Los dos choques que el motor ya impide, comprobados antes para poder NOMBRAR la cuenta
 * que estorba: `app_user_person_id_key` y `app_user_email_key` frenan igual, pero su
 * mensaje no dice de quién es la cuenta que ya existe.
 */
async function checkConflicts(client, person, email) {
  if (person.account_id) {
    throw new Error(
      `${person.first_name} ${person.last_name} ya tiene cuenta: ${person.account_email} ` +
        `(${person.account_role}, ${person.account_id}). Una persona tiene a lo sumo una.`,
    );
  }

  const { rows } = await client.query('SELECT id, role FROM app_user WHERE email = $1', [email]);

  if (rows[0]) {
    throw new Error(
      `El email ${email} ya es de la cuenta ${rows[0].id} (${rows[0].role}). El email es único ` +
        'entre todas las cuentas, incluidas las dadas de baja.',
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Ver .env.example.');
  }

  const insertAccount = await loadInsertAccount();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const actor = await findActor(pool, args.actor);
    const sites = await resolveSites(pool, args.siteCodes, actor);

    // Todo lo demás bajo el alcance del actor: `person` no se ve sin él, y el alta tiene
    // que escribir la auditoría de cada planta. Las comprobaciones y el INSERT van en la
    // misma transacción, así que un fallo de cualquiera de ellas no deja nada atrás.
    const result = await asActor(pool, actor, async (client) => {
      const person = await findPerson(client, args.employeeNumber);

      // Idempotencia: la misma persona con el mismo email y el mismo rol es la corrida
      // que alguien repite porque no está seguro de si la primera funcionó. Informa y
      // sale con 0. Un `ON CONFLICT DO NOTHING` habría hecho que la segunda se vea igual
      // que la primera, que es la forma más rápida de creer que se creó algo que no se
      // creó.
      if (
        person.account_id &&
        person.account_email === args.email &&
        person.account_role === args.role
      ) {
        return { person, existing: person.account_id };
      }

      await checkConflicts(client, person, args.email);

      // Se avisa y NO se frena, las dos veces. El alcance es una propiedad de las filas
      // otorgadas y no del rol (`identity/spec.md`, "Site scope decides what an account
      // can see"), así que convertirlo en error metería en un script una regla que la
      // spec deliberadamente no puso en el motor.
      if (SINGLE_SITE_ROLES.includes(args.role) && sites.length > 1) {
        process.stderr.write(
          `Aviso: ${args.role} con ${sites.length} plantas. Normalmente solo coordinator y ` +
            'management llevan las dos.\n',
        );
      }

      if (!sites.some((site) => site.code === person.site_code)) {
        process.stderr.write(
          `Aviso: ${args.employeeNumber} está en ${person.site_code} y la cuenta va a alcanzar ` +
            `${sites.map((site) => site.code).join(', ')}.\n`,
        );
      }

      const userId = await insertAccount(client, {
        personId: person.id,
        email: args.email,
        role: args.role,
        siteIds: sites.map((site) => site.id),
      });

      return { person, userId };
    });

    if (result.existing) {
      process.stdout.write(
        [
          '',
          'La cuenta ya existía; no se creó nada.',
          '',
          `  cuenta      ${result.person.account_email} (${result.person.account_role})`,
          `  userId      ${result.existing}`,
          '',
          `  pnpm auth:bootstrap ${result.existing}`,
          '',
        ].join('\n'),
      );

      return;
    }

    const { person, userId } = result;

    process.stdout.write(
      [
        '',
        'Cuenta creada.',
        '',
        `  persona     ${person.first_name} ${person.last_name} (${args.employeeNumber})`,
        `  cuenta      ${args.email} (${args.role})`,
        `  userId      ${userId}`,
        `  alcance     ${sites.map((site) => site.code).join(', ')}`,
        `  alta por    ${actor.email}`,
        '',
        'NO puede iniciar sesión todavía: nace sin credencial. Emitile la invitación con',
        '',
        `  pnpm auth:bootstrap ${userId}`,
        '',
        'y pasale el link /accept-invitation?token=<token> que imprime.',
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
