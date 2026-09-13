import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withSiteScope } from '../src/db/site-scope';
import { registerSite } from './helpers/catalog';
import {
  createAccount,
  createPerson,
  effectiveScope,
  personById,
  selectablePeople,
} from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createAuthStack, grantCredential } from './helpers/auth';

/**
 * Requisitos §4 ("Persona ≠ Usuario") y §5 riesgo I (ciclo de vida del auditor
 * externo).
 *
 * Lo que este spec protege no es "que se pueda crear una persona": es que el
 * segundo dolor de Atlas sea un estado imposible de reintroducir. Una persona que
 * para existir necesita cuenta, una cuenta compartida, un alcance que se revoca sin
 * dejar rastro y un auditor externo sin vencimiento no fallan de forma visible si la
 * garantía vive en el servicio — la operación funciona y el permiso queda abierto.
 */

const SITE_A = '88888888-0000-4000-8000-00000000000a';
const SITE_B = '88888888-0000-4000-8000-00000000000b';

/** insufficient_privilege. También es el SQLSTATE de una violación de política RLS. */
const INSUFFICIENT_PRIVILEGE = '42501';

/** El SQLSTATE propio de los triggers de inmutabilidad (0001, 0004, 0005). */
const APPEND_ONLY = 'HS001';

const UNIQUE_VIOLATION = '23505';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

let db: TestDatabase;

/** La cuenta que actúa en los tests de auditoría. Alcance a las dos plantas. */
let actor: string;

beforeAll(async () => {
  db = await startTestDatabase();

  await registerSite(db.migrator, SITE_A, 'identity-a', 'Identity A');
  await registerSite(db.migrator, SITE_B, 'identity-b', 'Identity B');

  actor = (await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] })).accountId;
});

afterAll(async () => {
  await db?.stop();
});

/** Las entradas de auditoría de un sitio, de la más vieja a la más nueva. */
async function entriesFor(siteId: string, subjectKey: string, subjectId: string) {
  return inScope<{ event_type: string; payload: Record<string, unknown>; actor_user_id: string | null }>(
    db.migrator,
    [siteId],
    `SELECT event_type, payload, actor_user_id
       FROM audit_log
      WHERE site_id = $1 AND payload ->> $2 = $3
      ORDER BY seq`,
    [siteId, subjectKey, subjectId],
  );
}

/** Los `event_type` de un sujeto en un sitio, en orden. */
async function eventsFor(siteId: string, subjectKey: string, subjectId: string) {
  return (await entriesFor(siteId, subjectKey, subjectId)).map((entry) => entry.event_type);
}

// ---------------------------------------------------------------------------
describe('la persona existe sin cuenta', () => {
  it('una persona del roster no necesita ninguna cuenta para existir ni para ser elegible', async () => {
    const id = await createPerson(db.migrator, SITE_A, { lastName: 'Sincuenta' });

    const accounts = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM app_user WHERE person_id = $1',
      [id],
    );

    expect(one(accounts).count).toBe('0');
    expect((await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id)).toContain(id);
  });

  it('el roster puede superar a las cuentas por cualquier cantidad', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createPerson(db.migrator, SITE_A);
    }

    const counts = await inScope<{ people: string; accounts: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      `SELECT (SELECT count(*)::text FROM person) AS people,
              (SELECT count(*)::text FROM app_user) AS accounts`,
    );

    expect(Number(one(counts).people)).toBeGreaterThan(Number(one(counts).accounts));
  });
});

// ---------------------------------------------------------------------------
describe('la identidad de una persona es el número de empleado', () => {
  it('un número de empleado duplicado se rechaza', async () => {
    await createPerson(db.migrator, SITE_A, { employeeNumber: 'DUP-1' });

    await expect(
      createPerson(db.migrator, SITE_A, { employeeNumber: 'DUP-1' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('hs_app puede corregir el número y conserva el id', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'FROZEN-1' });

    await withSiteScope(db.app, { siteIds: [SITE_A], userId: actor }, (client) =>
      client.query('UPDATE person SET employee_number = $1 WHERE id = $2', ['FROZEN-2', id]),
    );

    expect(await personById(db.migrator, [SITE_A], id)).toMatchObject({
      id,
      employee_number: 'FROZEN-2',
    });
  });

  it('corregir al número de otra persona falla con unique violation', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'FROZEN-3' });
    const other = await createPerson(db.migrator, SITE_A, { employeeNumber: 'FROZEN-4' });

    await expect(
      withSiteScope(db.app, { siteIds: [SITE_A], userId: actor }, (client) =>
        client.query('UPDATE person SET employee_number = $1 WHERE id = $2', ['FROZEN-4', id]),
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

    expect((await personById(db.migrator, [SITE_A], id)).employee_number).toBe('FROZEN-3');
    expect((await personById(db.migrator, [SITE_A], other)).employee_number).toBe('FROZEN-4');
  });

  it('cambiar el id se rechaza con HS001, incluso como dueño de la tabla', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'FROZEN-5' });

    await expect(
      inScope(db.migrator, [SITE_A], 'UPDATE person SET id = gen_random_uuid() WHERE id = $1', [id]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });

    expect((await personById(db.migrator, [SITE_A], id)).id).toBe(id);
  });

  it('dos personas activas pueden llamarse igual — el nombre no identifica', async () => {
    const first = await createPerson(db.migrator, SITE_A, { firstName: 'Sam', lastName: 'Rivas' });
    const second = await createPerson(db.migrator, SITE_A, { firstName: 'Sam', lastName: 'Rivas' });

    const people = await selectablePeople(db.migrator, [SITE_A]);
    const both = people.filter((row) => row.id === first || row.id === second);

    expect(both).toHaveLength(2);
    expect(both[0]!.employee_number).not.toBe(both[1]!.employee_number);
  });

  it('corregir un nombre funciona y se relee', async () => {
    const id = await createPerson(db.migrator, SITE_A, { lastName: 'Maltipeado' });

    await withSiteScope(db.app, { siteIds: [SITE_A] }, (client) =>
      client.query('UPDATE person SET last_name = $1 WHERE id = $2', ['Bien tipeado', id]),
    );

    expect((await personById(db.migrator, [SITE_A], id)).last_name).toBe('Bien tipeado');
  });

  it('una persona sin sitio se rechaza', async () => {
    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        `INSERT INTO person (employee_number, first_name, last_name, site_id)
         VALUES ('NOSITE-1', 'No', 'Site', NULL)`,
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/23502|42501/) });
  });
});

// ---------------------------------------------------------------------------
describe('la baja de una persona es lógica', () => {
  it('DELETE se rechaza con 42501 para hs_app y con HS001 para el dueño', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await expect(
      withSiteScope(db.app, { siteIds: [SITE_A] }, (client) =>
        client.query('DELETE FROM person WHERE id = $1', [id]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM person WHERE id = $1', [id]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });

    expect((await personById(db.migrator, [SITE_A], id)).id).toBe(id);
  });

  it('una persona desactivada no se ofrece y sigue resolviendo desde el historial', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'GONE-1' });

    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [
      id,
    ]);

    expect((await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id)).not.toContain(id);

    const still = await personById(db.migrator, [SITE_A], id);
    expect(still.employee_number).toBe('GONE-1');
    expect(still.deactivated_at).not.toBeNull();
  });

  it('reactivar la vuelve a ofrecer', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [id]);
    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = NULL WHERE id = $1', [id]);

    expect((await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id)).toContain(id);
  });
});

// ---------------------------------------------------------------------------
describe('el roster está aislado por sitio', () => {
  let atA: string;
  let atB: string;

  beforeAll(async () => {
    atA = await createPerson(db.migrator, SITE_A, { lastName: 'SoloA' });
    atB = await createPerson(db.migrator, SITE_B, { lastName: 'SoloB' });
  });

  it('con alcance de un sitio se ven solo sus personas', async () => {
    const ids = (await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id);

    expect(ids).toContain(atA);
    expect(ids).not.toContain(atB);
  });

  it('con alcance de los dos se ven las dos', async () => {
    const ids = (await selectablePeople(db.migrator, [SITE_A, SITE_B])).map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([atA, atB]));
  });

  it('sin declarar alcance devuelve cero filas y no lanza error', async () => {
    // Las dos afirmaciones juntas a propósito: la forma de fallar de este bug es
    // "el selector se ve vacío", no una excepción.
    await expect(inScope(db.app, [], 'SELECT id FROM person')).resolves.toEqual([]);
  });

  it('el dueño de la tabla tampoco evade la política', async () => {
    const ids = (await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id);

    expect(ids).not.toContain(atB);
  });

  it('insertar una persona de otro sitio fuera del alcance se rechaza', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO person (employee_number, first_name, last_name, site_id)
         VALUES ('OUT-1', 'Out', 'Of scope', $1)`,
        [SITE_B],
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });
});

// ---------------------------------------------------------------------------
describe('la transferencia de planta', () => {
  it('con las dos plantas en el alcance, la persona se muda', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await withSiteScope(db.app, { siteIds: [SITE_A, SITE_B], userId: actor }, (client) =>
      client.query('UPDATE person SET site_id = $1 WHERE id = $2', [SITE_B, id]),
    );

    expect((await personById(db.migrator, [SITE_B], id)).site_id).toBe(SITE_B);
    expect((await selectablePeople(db.migrator, [SITE_B])).map((row) => row.id)).toContain(id);
  });

  it('con una sola planta en el alcance, la política la rechaza', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await expect(
      withSiteScope(db.app, { siteIds: [SITE_A] }, (client) =>
        client.query('UPDATE person SET site_id = $1 WHERE id = $2', [SITE_B, id]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    expect((await personById(db.migrator, [SITE_A], id)).site_id).toBe(SITE_A);
  });
});

// ---------------------------------------------------------------------------
describe('una cuenta siempre pertenece a una persona', () => {
  it('sin persona se rechaza', async () => {
    await expect(
      inScope(
        db.migrator,
        [],
        `INSERT INTO app_user (person_id, email, role)
         VALUES (NULL, 'nobody@example.com', 'supervisor')`,
      ),
    ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
  });

  it('con una persona inexistente se rechaza con FK', async () => {
    await expect(
      inScope(
        db.migrator,
        [],
        `INSERT INTO app_user (person_id, email, role)
         VALUES ('88888888-0000-4000-8000-0000000000ff', 'ghost@example.com', 'management')`,
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it('una segunda cuenta para la misma persona se rechaza — ADR-011 prohíbe la cuenta compartida', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        `INSERT INTO app_user (person_id, email, role) VALUES ($1, 'second@example.com', 'management')`,
        [seeded.personId],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('reasignar la cuenta a otra persona se rechaza con HS001', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });
    const other = await createPerson(db.migrator, SITE_A);

    await expect(
      inScope(db.migrator, [SITE_A], 'UPDATE app_user SET person_id = $1 WHERE id = $2', [
        other,
        seeded.accountId,
      ]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });
  });
});

// ---------------------------------------------------------------------------
describe('el email de la cuenta', () => {
  it('un duplicado se rechaza', async () => {
    await createAccount(db.migrator, { siteIds: [SITE_A], email: 'taken@example.com' });

    await expect(
      createAccount(db.migrator, { siteIds: [SITE_A], email: 'taken@example.com' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('otra capitalización del mismo buzón choca con el único, no con un CHECK', async () => {
    await createAccount(db.migrator, { siteIds: [SITE_A], email: 'case@example.com' });

    await expect(
      createAccount(db.migrator, { siteIds: [SITE_A], email: 'Case@Example.COM' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('el email de una cuenta dada de baja sigue tomado', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A], email: 'left@example.com' });

    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      seeded.accountId,
    ]);

    await expect(
      createAccount(db.migrator, { siteIds: [SITE_A], email: 'left@example.com' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('un email sin arroba se rechaza con CHECK', async () => {
    await expect(
      createAccount(db.migrator, { siteIds: [SITE_A], email: 'no-arroba' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('se guarda normalizado a minúsculas', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A], email: 'MiXeD@Example.com' });

    const rows = await inScope<{ email: string }>(
      db.migrator,
      [],
      'SELECT email FROM app_user WHERE id = $1',
      [seeded.accountId],
    );

    expect(one(rows).email).toBe('mixed@example.com');
  });
});

// ---------------------------------------------------------------------------
describe('el rol es uno, de un conjunto cerrado', () => {
  it('"inspector" es un rol de cuenta y también nombra el campo de la inspección', async () => {
    const created = await createAccount(db.migrator, { siteIds: [SITE_A], role: 'inspector' });

    expect(created.accountId).toBeTruthy();
  });

  it('un rol nulo se rechaza', async () => {
    const personId = await createPerson(db.migrator, SITE_A);

    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        `INSERT INTO app_user (person_id, email, role) VALUES ($1, 'norole@example.com', NULL)`,
        [personId],
      ),
    ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
  });

  it('los tres roles de ADR-022 se aceptan y los retirados se rechazan', async () => {
    for (const role of ['coordinator', 'inspector', 'management']) {
      const seeded = await createAccount(db.migrator, { siteIds: [SITE_A], role });
      expect(seeded.accountId).toBeTruthy();
    }

    for (const role of ['supervisor', 'external_auditor']) {
      await expect(
        createAccount(db.migrator, { siteIds: [SITE_A], role }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    }
  });
});

// ---------------------------------------------------------------------------
describe('la baja de una cuenta', () => {
  it('DELETE se rechaza con 42501 para hs_app y con HS001 para el dueño', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM app_user WHERE id = $1', [seeded.accountId]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM app_user WHERE id = $1', [seeded.accountId]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });
  });

  it('dar de baja la cuenta no da de baja a la persona — perder el acceso no es irse de la empresa', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      seeded.accountId,
    ]);

    expect((await personById(db.migrator, [SITE_A], seeded.personId)).deactivated_at).toBeNull();
    expect((await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id)).toContain(
      seeded.personId,
    );
  });
});

// ---------------------------------------------------------------------------
describe('la cuenta no guarda ninguna credencial', () => {
  it('el esquema no declara contraseña, hash, token, sesión ni secreto TOTP', async () => {
    const columns = await inScope<{ column_name: string }>(
      db.migrator,
      [],
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'app_user'`,
    );

    const names = columns.map((row) => row.column_name).join(' ');

    expect(names).not.toMatch(/pass|hash|salt|token|session|secret|totp|otp/i);
  });
});

// ---------------------------------------------------------------------------
describe('el alcance por sitio', () => {
  it('se otorga y se lee', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    expect(await effectiveScope(db.migrator, seeded.accountId)).toEqual([SITE_A]);
  });

  it('un segundo otorgamiento vigente del mismo sitio se rechaza', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.migrator, [SITE_A], 'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
        seeded.accountId,
        SITE_A,
      ]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('revocar saca el sitio del alcance y deja la fila con las dos fechas', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] });

    await inScope(
      db.migrator,
      [SITE_B],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
      [seeded.accountId, SITE_B],
    );

    expect(await effectiveScope(db.migrator, seeded.accountId)).toEqual([SITE_A]);

    const rows = await inScope<{ granted_at: Date; revoked_at: Date | null }>(
      db.migrator,
      [],
      'SELECT granted_at, revoked_at FROM user_site_scope WHERE user_id = $1 AND site_id = $2',
      [seeded.accountId, SITE_B],
    );

    expect(one(rows).granted_at).toBeInstanceOf(Date);
    expect(one(rows).revoked_at).toBeInstanceOf(Date);
  });

  it('un sitio revocado se puede volver a otorgar, y quedan las dos filas', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await inScope(
      db.migrator,
      [SITE_A],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
      [seeded.accountId, SITE_A],
    );

    await inScope(db.migrator, [SITE_A], 'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
      seeded.accountId,
      SITE_A,
    ]);

    expect(await effectiveScope(db.migrator, seeded.accountId)).toEqual([SITE_A]);

    const rows = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM user_site_scope WHERE user_id = $1 AND site_id = $2',
      [seeded.accountId, SITE_A],
    );

    expect(one(rows).count).toBe('2');
  });

  it('borrar una fila de alcance se rechaza — revocar es un UPDATE', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM user_site_scope WHERE user_id = $1', [
        seeded.accountId,
      ]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });

    expect(await effectiveScope(db.migrator, seeded.accountId)).toEqual([SITE_A]);
  });

  it('un sitio inexistente se rechaza con FK', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.migrator, [SITE_A], 'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
        seeded.accountId,
        '88888888-0000-4000-8000-0000000000fe',
      ]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/23503|HS002/) });
  });
});

// ---------------------------------------------------------------------------
describe('el alcance manda, el rol no', () => {
  it('una cuenta sin alcance vigente no ve ninguna fila aislada, aunque sea coordinadora', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A], role: 'coordinator' });

    await inScope(
      db.migrator,
      [SITE_A],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1',
      [seeded.accountId],
    );

    const scope = await effectiveScope(db.migrator, seeded.accountId);
    expect(scope).toEqual([]);

    await expect(
      withSiteScope(db.app, { siteIds: scope, userId: seeded.accountId }, (client) =>
        client.query('SELECT id FROM person').then((result) => result.rows),
      ),
    ).resolves.toEqual([]);
  });

  /**
   * ADR-011 — Este caso es el que la etapa 2 de §7 tiene que dejar probado:
   * *"permisos por sitio verificados con datos reales"*.
   *
   * Y por eso NO declara el alcance a mano. Un test que fija `app.site_ids` con la
   * lista que él mismo armó prueba que la política RLS funciona, que es una cosa
   * distinta y ya está probada más arriba. Lo que falta probar —y lo que un inspector
   * del MLITSD preguntaría— es que el alcance con el que la aplicación consulta sea el
   * de la persona que inició sesión, y eso solo se prueba iniciando sesión.
   *
   * El recorrido completo, sin atajos: el coordinador invita, el titular acepta y fija
   * su contraseña, entra con email y contraseña, y el alcance sale del token.
   */
  it('un inspector que INICIÓ SESIÓN de verdad no ve la otra planta', async () => {
    const stack = createAuthStack(db.appUrl);

    try {
      const coordinator = await createAccount(db.migrator, {
        siteIds: [SITE_A, SITE_B],
        role: 'coordinator',
      });

      const member = await createAccount(db.migrator, { siteIds: [SITE_A], role: 'inspector' });
      const atB = await createPerson(db.migrator, SITE_B);

      const password = 'a-long-enough-password';
      await grantCredential(
        stack,
        { userId: coordinator.accountId, role: 'coordinator' },
        member.accountId,
        password,
      );

      const { tokens } = await stack.auth.signIn({ email: member.email, password });
      const session = await stack.sessions.resolve(tokens.accessToken);

      expect(session.siteIds).toEqual([SITE_A]);

      const visible = await stack.db.withSession(session, (dbx) =>
        dbx.execute(`SELECT id FROM person` as never),
      );

      const rows = (visible as unknown as { rows: { id: string }[] }).rows;

      expect(rows.map((row) => row.id)).not.toContain(atB);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await stack.stop();
    }
  });
});

// ---------------------------------------------------------------------------
describe('la auditoría de la identidad la escribe el motor', () => {
  it('crear una persona escribe una entrada con su número de empleado', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'AUD-1' });

    const [entry] = await entriesFor(SITE_A, 'person_id', id);

    expect(entry!.event_type).toBe('person.created');
    expect(entry!.payload.employee_number).toBe('AUD-1');
  });

  it('renombrar escribe una entrada con el nombre anterior y el nuevo', async () => {
    const id = await createPerson(db.migrator, SITE_A, { lastName: 'Antes' });

    await inScope(db.migrator, [SITE_A], 'UPDATE person SET last_name = $1 WHERE id = $2', [
      'Después',
      id,
    ]);

    const [, renamed] = await entriesFor(SITE_A, 'person_id', id);

    expect(renamed!.event_type).toBe('person.renamed');
    expect(renamed!.payload.previous_last_name).toBe('Antes');
    expect(renamed!.payload.last_name).toBe('Después');
  });

  it('renumerar escribe una entrada con los dos números', async () => {
    const id = await createPerson(db.migrator, SITE_A, { employeeNumber: 'AUD-OLD' });

    await withSiteScope(db.app, { siteIds: [SITE_A], userId: actor }, (client) =>
      client.query('UPDATE person SET employee_number = $1 WHERE id = $2', ['AUD-NEW', id]),
    );

    const [, renumbered] = await entriesFor(SITE_A, 'person_id', id);

    expect(renumbered!.event_type).toBe('person.renumbered');
    expect(renumbered!.payload.previous_employee_number).toBe('AUD-OLD');
    expect(renumbered!.payload.employee_number).toBe('AUD-NEW');
  });

  it('un cambio de nombre y número escribe dos entradas independientes', async () => {
    const id = await createPerson(db.migrator, SITE_A, {
      employeeNumber: 'AUD-BOTH-OLD',
      firstName: 'Nombre anterior',
    });

    await withSiteScope(db.app, { siteIds: [SITE_A], userId: actor }, (client) =>
      client.query(
        'UPDATE person SET first_name = $1, employee_number = $2 WHERE id = $3',
        ['Nombre nuevo', 'AUD-BOTH-NEW', id],
      ),
    );

    const entries = await entriesFor(SITE_A, 'person_id', id);

    expect(entries.map((entry) => entry.event_type)).toEqual([
      'person.created',
      'person.renamed',
      'person.renumbered',
    ]);
    expect(entries[2]!.payload.previous_employee_number).toBe('AUD-BOTH-OLD');
    expect(entries[2]!.payload.employee_number).toBe('AUD-BOTH-NEW');
  });

  it('desactivar y reactivar son dos eventos distintos', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [id]);
    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = NULL WHERE id = $1', [id]);

    expect(await eventsFor(SITE_A, 'person_id', id)).toEqual([
      'person.created',
      'person.deactivated',
      'person.reactivated',
    ]);
  });

  it('un update que no cambia nada observable no escribe nada', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await inScope(db.migrator, [SITE_A], 'UPDATE person SET last_name = last_name WHERE id = $1', [id]);

    expect(await entriesFor(SITE_A, 'person_id', id)).toHaveLength(1);
  });

  it('la transferencia escribe una entrada en cada cadena, y las dos nombran origen y destino', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await inScope(db.migrator, [SITE_A, SITE_B], 'UPDATE person SET site_id = $1 WHERE id = $2', [
      SITE_B,
      id,
    ]);

    const left = await entriesFor(SITE_A, 'person_id', id);
    const joined = await entriesFor(SITE_B, 'person_id', id);

    expect(left.map((entry) => entry.event_type)).toEqual(['person.created', 'person.transferred']);
    expect(joined.map((entry) => entry.event_type)).toEqual(['person.transferred']);

    for (const entry of [left[1]!, joined[0]!]) {
      expect(entry.payload.from_site_id).toBe(SITE_A);
      expect(entry.payload.to_site_id).toBe(SITE_B);
    }
  });

  it('el actor sale del alcance de la transacción', async () => {
    const id = await createPerson(db.migrator, SITE_A);

    await withSiteScope(db.app, { siteIds: [SITE_A], userId: actor }, (client) =>
      client.query('UPDATE person SET first_name = $1 WHERE id = $2', ['Renombrada', id]),
    );

    const [, renamed] = await entriesFor(SITE_A, 'person_id', id);

    expect(renamed!.actor_user_id).toBe(actor);
  });

  it('un cambio en una transacción abortada no deja entrada', async () => {
    const id = await createPerson(db.migrator, SITE_A, { lastName: 'Sobrevive' });
    const client = await db.migrator.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', SITE_A]);
      await client.query('UPDATE person SET last_name = $1 WHERE id = $2', ['Nunca pasó', id]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await entriesFor(SITE_A, 'person_id', id)).toHaveLength(1);
    expect((await personById(db.migrator, [SITE_A], id)).last_name).toBe('Sobrevive');
  });
});

// ---------------------------------------------------------------------------
describe('la auditoría de la cuenta se abre por planta del alcance', () => {
  it('crear una cuenta con las dos plantas escribe una entrada en cada cadena', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] });

    for (const site of [SITE_A, SITE_B]) {
      const created = (await entriesFor(site, 'account_id', seeded.accountId)).filter(
        (entry) => entry.event_type === 'user.created',
      );

      expect(created).toHaveLength(1);
      expect(created[0]!.payload.person_id).toBe(seeded.personId);
      expect(created[0]!.payload.role).toBe('coordinator');
    }
  });

  it('una cuenta sin alcance vigente no escribe ninguna entrada — no alcanza ninguna planta', async () => {
    const personId = await createPerson(db.migrator, SITE_A);

    const rows = await inScope<{ id: string }>(
      db.migrator,
      [SITE_A],
      `INSERT INTO app_user (person_id, email, role)
       VALUES ($1, 'noscope@example.com', 'management') RETURNING id`,
      [personId],
    );

    const accountId = one(rows).id;

    expect(await entriesFor(SITE_A, 'account_id', accountId)).toHaveLength(0);
    expect(await entriesFor(SITE_B, 'account_id', accountId)).toHaveLength(0);
  });

  it('cambiar el rol escribe una entrada por planta, con el rol anterior y el nuevo', async () => {
    const seeded = await createAccount(db.migrator, {
      siteIds: [SITE_A, SITE_B],
      role: 'inspector',
    });

    await inScope(db.migrator, [SITE_A, SITE_B], 'UPDATE app_user SET role = $1 WHERE id = $2', [
      'coordinator',
      seeded.accountId,
    ]);

    for (const site of [SITE_A, SITE_B]) {
      const [changed] = (await entriesFor(site, 'account_id', seeded.accountId)).filter(
        (entry) => entry.event_type === 'user.role_changed',
      );

      expect(changed!.payload.previous_role).toBe('inspector');
      expect(changed!.payload.role).toBe('coordinator');
    }
  });

  it('cambiar el email escribe una entrada con los dos valores', async () => {
    const seeded = await createAccount(db.migrator, {
      siteIds: [SITE_A],
      email: 'antes@example.com',
    });

    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET email = $1 WHERE id = $2', [
      'despues@example.com',
      seeded.accountId,
    ]);

    const [changed] = (await entriesFor(SITE_A, 'account_id', seeded.accountId)).filter(
      (entry) => entry.event_type === 'user.email_changed',
    );

    expect(changed!.payload.previous_email).toBe('antes@example.com');
    expect(changed!.payload.email).toBe('despues@example.com');
  });

  it('dar de baja escribe una entrada en cada planta que alcanzaba', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] });

    await inScope(
      db.migrator,
      [SITE_A, SITE_B],
      'UPDATE app_user SET deactivated_at = now() WHERE id = $1',
      [seeded.accountId],
    );

    for (const site of [SITE_A, SITE_B]) {
      const events = await eventsFor(site, 'account_id', seeded.accountId);
      expect(events).toContain('user.deactivated');
    }
  });

  it('otorgar un sitio se registra solo en la cadena de ese sitio', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await inScope(db.migrator, [SITE_B], 'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
      seeded.accountId,
      SITE_B,
    ]);

    const atB = await eventsFor(SITE_B, 'account_id', seeded.accountId);
    const atA = await eventsFor(SITE_A, 'account_id', seeded.accountId);

    expect(atB).toEqual(['user.scope_granted']);

    // La cadena de A queda EXACTAMENTE como estaba: su propio otorgamiento del
    // alta y el alta misma, que sí la alcanzaba. Que a esta cuenta le hayan dado
    // acceso a la otra planta no es un hecho de A.
    expect(atA).toEqual(['user.scope_granted', 'user.created']);
  });

  it('revocar un sitio se registra en la cadena de ese sitio', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] });

    await inScope(
      db.migrator,
      [SITE_B],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
      [seeded.accountId, SITE_B],
    );

    expect(await eventsFor(SITE_B, 'account_id', seeded.accountId)).toContain('user.scope_revoked');
  });

  it('administrar una planta fuera del alcance declarado se frena con HS002, no con un error de política', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.migrator, [SITE_A], 'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
        seeded.accountId,
        SITE_B,
      ]),
    ).rejects.toMatchObject({ code: 'HS002' });
  });
});

// ---------------------------------------------------------------------------
describe('la FK del actor y la cadena', () => {
  it('un actor inexistente se rechaza con FK', async () => {
    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        `INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
         VALUES ($1, '88888888-0000-4000-8000-0000000000fd', 'test.event', '{}'::jsonb, now(), now(), ''::bytea)`,
        [SITE_A],
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it('un actor nulo entra y se encadena', async () => {
    const rows = await inScope<{ hash: Buffer }>(
      db.migrator,
      [SITE_A],
      `INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
       VALUES ($1, NULL, 'test.system', '{}'::jsonb, now(), now(), ''::bytea)
       RETURNING hash`,
      [SITE_A],
    );

    expect(one(rows).hash.length).toBe(32);
  });

  it('borrar una cuenta con entradas falla y quedan las dos cosas', async () => {
    const seeded = await createAccount(db.migrator, { siteIds: [SITE_A] });

    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM app_user WHERE id = $1', [seeded.accountId]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });

    const rows = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM app_user WHERE id = $1',
      [seeded.accountId],
    );

    expect(one(rows).count).toBe('1');
    expect(await entriesFor(SITE_A, 'account_id', seeded.accountId)).not.toHaveLength(0);
  });

  it('la cadena de las dos plantas sigue verificando después de todos los eventos de identidad', async () => {
    for (const site of [SITE_A, SITE_B]) {
      const broken = await inScope(
        db.migrator,
        [site],
        'SELECT * FROM hs_audit_verify_chain($1)',
        [site],
      );

      expect(broken).toEqual([]);
    }
  });
});
