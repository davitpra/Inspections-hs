import { randomBytes } from 'node:crypto';

import pg from 'pg';

import { issueInvitation } from './bootstrap-invitation.mjs';

/**
 * Devolverle el acceso a una cuenta de un entorno de desarrollo: destrabar el bloqueo
 * por intentos fallidos, o poner una contraseña nueva cuando la anterior se perdió.
 *
 * NO CORRE EN PRODUCCIÓN, y la guarda es lo primero que hace. Ahí las dos cosas tienen
 * dueño y no son este script: el bloqueo se espera —quince minutos, D8— y la credencial
 * la revoca el coordinador desde la aplicación (`POST /auth/credentials/revoke`). Un
 * comando que saltee las dos cosas desde una terminal es exactamente lo que ADR-011 no
 * quiere que exista del lado de producción.
 *
 * POR QUÉ HACE FALTA IGUAL. En desarrollo la base se resetea seguido y las dos salidas
 * de arriba no están: el bloqueo cuesta quince minutos de espera, y revocar la
 * credencial pide una sesión de coordinador que es justo la que no se tiene cuando se
 * perdió su contraseña. Huevo y gallina, el mismo de `auth:bootstrap`.
 *
 * NO INVENTA UNA VÍA NUEVA PARA LA CONTRASEÑA. Revoca la credencial, emite una
 * invitación con `issueInvitation()` y la acepta contra `POST /auth/invitations/accept`
 * — el mismo camino que recorre cualquier alta. Escribir el hash a mano acá sería un
 * segundo lugar donde vive el formato de la credencial, y el día que cambie, este script
 * seguiría produciendo el viejo.
 *
 * Corre como `hs_app`, igual que `bootstrap-invitation.mjs`.
 *
 *   pnpm auth:reset-password coordinator@example.com
 *   pnpm auth:reset-password <userId> --unlock
 *   pnpm auth:reset-password <userId> --password una-contraseña-larga
 */

/**
 * El alcance de la propia cuenta, declarado antes de tocarla.
 *
 * `hs_account_audit_fanout()` (0005 §8) escribe en la cadena de CADA planta que la
 * cuenta alcanza y frena con HS002 si alguna no está declarada. `asAdministrator()` en
 * `src/auth/account-scope.ts` declara el alcance del ACTOR; acá el actor es la cuenta
 * misma —no hay sesión detrás— y por eso son el mismo conjunto. Es la misma vía que usa
 * `bootstrap-invitation.mjs` para la primera invitación del sistema.
 */
async function inOwnScope(pool, userId, run) {
  const { rows: scope } = await pool.query(
    `SELECT coalesce(string_agg(site_id::text, ',' ORDER BY site_id), '') AS site_ids
       FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', scope[0].site_ids]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);

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

/** La cuenta activa, por id o por email — lo que se haya escrito en la línea. */
async function findAccount(pool, target) {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role,
            c.id AS credential_id, c.locked_until, c.failed_attempts
       FROM app_user u
       LEFT JOIN app_credential c ON c.user_id = u.id AND c.revoked_at IS NULL
      WHERE ${byId ? 'u.id = $1' : 'u.email = lower($1)'} AND u.deactivated_at IS NULL`,
    [target],
  );

  if (!rows[0]) throw new Error(`No existe una cuenta activa para ${target}.`);

  return rows[0];
}

/**
 * Destraba el bloqueo por intentos fallidos. Las mismas dos columnas que mueve
 * `CredentialService.registerFailure()`, en el sentido contrario.
 */
async function unlock(pool, account) {
  if (!account.credential_id) {
    throw new Error(
      `La cuenta ${account.email} no tiene credencial activa: no hay nada que destrabar. ` +
        'Corré esto sin `--unlock` para ponerle una contraseña.',
    );
  }

  await inOwnScope(pool, account.id, (client) =>
    client.query(
      `UPDATE app_credential
          SET failed_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [account.credential_id],
    ),
  );
}

/**
 * Revoca la credencial vigente y pone una nueva por la vía normal: invitación emitida y
 * aceptada. La aceptación es HTTP porque el hash de la contraseña lo produce el motor
 * que vive en la API, no este proceso.
 */
async function resetPassword(pool, account, apiBaseUrl, password) {
  if (account.credential_id) {
    // Las dos cosas juntas, porque `POST /auth/credentials/revoke` hace las dos:
    // revoca la credencial Y corta las sesiones vivas. Revocar solo la credencial
    // dejaría entrando a quien ya tuviera un token — que es la mitad del punto de
    // revocarla. Ver `auth.controller.ts` y `SessionService.revokeAllForUser()`.
    await inOwnScope(pool, account.id, async (client) => {
      await client.query('UPDATE app_credential SET revoked_at = now() WHERE id = $1', [
        account.credential_id,
      ]);

      await client.query(
        `UPDATE app_session
            SET revoked_at = now(), revoked_reason = 'credential_revoked'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [account.id],
      );

      await client.query(
        `UPDATE app_refresh_token r
            SET revoked_at = now()
           FROM app_session s
          WHERE s.id = r.session_id AND s.user_id = $1 AND r.revoked_at IS NULL`,
        [account.id],
      );
    });
  }

  const invitation = await issueInvitation(pool, account.id);

  let response;

  try {
    response = await fetch(new URL('/auth/invitations/accept', apiBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invitation.token, password }),
    });
  } catch (error) {
    // La credencial vieja ya está revocada y la invitación emitida: decir dónde quedó
    // todo importa más que el mensaje de red, porque el token sigue siendo válido.
    throw new Error(
      `No se pudo hablar con la API en ${apiBaseUrl} (${error.message}). La credencial ` +
        'anterior ya quedó revocada; arrancá la API y aceptá la invitación con:\n\n' +
        `  curl -X POST ${apiBaseUrl}/auth/invitations/accept -H 'content-type: application/json' \\\n` +
        `    -d '{"token":"${invitation.token}","password":"${password}"}'\n`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `POST /auth/invitations/accept respondió ${response.status}: ${await response.text()}`,
    );
  }
}

function parseArgs(argv) {
  const target = argv[0];

  if (!target || target.startsWith('--')) {
    throw new Error(
      'Falta la cuenta. Uso: pnpm auth:reset-password <userId|email> [--unlock] [--password <pw>]',
    );
  }

  const unlockOnly = argv.includes('--unlock');
  const passwordIndex = argv.indexOf('--password');

  if (unlockOnly && passwordIndex !== -1) {
    throw new Error('`--unlock` y `--password` se excluyen: el primero no toca la contraseña.');
  }

  const password =
    passwordIndex === -1
      ? // 24 caracteres al azar. Un default fijo acabaría copiado a un entorno donde
        // importa, que es la forma en que estas cosas se filtran.
        randomBytes(18).toString('base64url')
      : argv[passwordIndex + 1];

  if (!unlockOnly && (!password || password.length < 12)) {
    throw new Error('La contraseña tiene que tener al menos 12 caracteres (`passwordSchema`).');
  }

  return { target, unlockOnly, password };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'auth:reset-password no corre con NODE_ENV=production. Ahí el bloqueo se espera y la ' +
        'credencial la revoca el coordinador desde la aplicación.',
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Ver .env.example.');
  }

  const { target, unlockOnly, password } = parseArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const account = await findAccount(pool, target);
    const wasLocked =
      account.locked_until !== null && new Date(account.locked_until).getTime() > Date.now();

    if (unlockOnly) {
      await unlock(pool, account);

      process.stdout.write(
        [
          '',
          `Bloqueo levantado: ${account.email} (${account.role})`,
          wasLocked
            ? `  estaba trabada hasta ${new Date(account.locked_until).toISOString()}`
            : '  no estaba trabada; el contador de intentos quedó en cero igual',
          '  la contraseña no cambió',
          '',
        ].join('\n'),
      );

      return;
    }

    await resetPassword(pool, account, apiBaseUrl, password);

    process.stdout.write(
      [
        '',
        'Contraseña nueva.',
        '',
        `  cuenta      ${account.email} (${account.role})`,
        `  contraseña  ${password}`,
        '',
        'La credencial anterior quedó revocada y sus sesiones vivas, cortadas.',
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
