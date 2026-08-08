import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';

/**
 * ADR-011 — La PRIMERA invitación del sistema, y la única que se emite sin una sesión
 * de coordinador detrás.
 *
 * El huevo y la gallina: toda cuenta se da de alta por invitación de un
 * `hs_coordinator`, y la primera no puede — no hay coordinador que pueda iniciar
 * sesión todavía. `seeds/004_bootstrap_coordinator.sql` creó la identidad; este
 * comando le abre la puerta.
 *
 * ES UN COMANDO Y NO UN SEED, y la diferencia importa. Un seed que sembrara una
 * contraseña conocida sería una puerta abierta en cada entorno donde se corran los
 * seeds; un seed que sembrara una invitación la dejaría en la base de todos ellos con
 * el mismo token. Esto se corre una vez, a mano, y el token se muestra una sola vez.
 *
 * Corre como `hs_app` y no como `hs_migrator`: es una escritura de aplicación, y que
 * el rol restringido alcance para hacerla es parte de lo que prueba que la tabla está
 * bien concedida.
 */

const COORDINATOR_ID = 'acc00000-0000-4000-8000-000000000001';
const EXPIRES_IN_HOURS = 72;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

async function main() {
  const targetId = process.argv[2] ?? COORDINATOR_ID;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows: account } = await pool.query(
      `SELECT u.id, u.email, u.role,
              EXISTS (SELECT 1 FROM app_credential c
                       WHERE c.user_id = u.id AND c.revoked_at IS NULL) AS has_credential
         FROM app_user u
        WHERE u.id = $1 AND u.deactivated_at IS NULL`,
      [targetId],
    );

    if (!account[0]) {
      throw new Error(
        `No existe una cuenta activa con id ${targetId}. ¿Corriste \`pnpm db:seed\`?`,
      );
    }

    if (account[0].has_credential) {
      throw new Error(
        `La cuenta ${account[0].email} ya tiene credencial. Este comando existe solo para ` +
          'la primera; de acá en adelante las invitaciones las emite el coordinador desde ' +
          'la aplicación.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EXPIRES_IN_HOURS * 60 * 60 * 1000);

    // El emisor es la propia cuenta: no hay otra a la que atribuírselo, y dejar el
    // campo apuntando a alguien que no existió sería peor que decir la verdad —que la
    // primera invitación se la emitió el sistema a sí mismo, una sola vez.
    // El alcance, ANTES del INSERT. El trigger de auditoría de la invitación escribe
    // en la cadena de CADA planta del alcance de la cuenta, y frena con HS002 si
    // alguna no está declarada. La misma razón por la que
    // `004_bootstrap_coordinator.sql` empieza con un `set_config`.
    //
    // `app.user_id` además es lo que le pone actor a la entrada: sin él, la primera
    // invitación del sistema quedaría registrada sin nadie detrás.
    const { rows: scope } = await pool.query(
      `SELECT coalesce(string_agg(site_id::text, ',' ORDER BY site_id), '') AS site_ids
         FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
      [targetId],
    );

    const client = await pool.connect();
    let rows;

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', scope[0].site_ids]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', targetId]);

      ({ rows } = await client.query(
        `INSERT INTO user_invitation (user_id, issued_by_user_id, token_hash, expires_at)
         VALUES ($1, $1, $2, $3)
         RETURNING id`,
        [targetId, hashToken(token), expiresAt],
      ));

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    process.stdout.write(
      [
        '',
        'Invitación de bootstrap emitida.',
        '',
        `  cuenta      ${account[0].email} (${account[0].role})`,
        `  invitación  ${rows[0].id}`,
        `  vence       ${expiresAt.toISOString()}`,
        '',
        `  token       ${token}`,
        '',
        'El token se muestra UNA sola vez: del otro lado solo queda su hash. Se acepta con',
        'POST /auth/invitations/accept, y con eso el coordinador queda en condiciones de',
        'iniciar sesión e invitar al resto.',
        '',
        'Esta es la única invitación del sistema emitida sin una sesión de coordinador',
        'detrás. Todas las demás las emite él.',
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
