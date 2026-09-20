import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbService } from '../src/db/db.service';
import { AccountService } from '../src/auth/account.service';
import { RosterService } from '../src/roster/roster.service';
import { registerSite } from './helpers/catalog';
import { createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount, createPerson, selectablePeople } from './helpers/identity';
import { inScope, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * La consola del roster: leer quién trabaja en cada planta, corregir personas activas y dar de
 * baja un worker sin cuenta.
 *
 * LAS DOS PRUEBAS QUE JUSTIFICAN EL ARCHIVO son las dos mitades del aislamiento:
 *
 *   - Un alcance de una planta pide el roster de la otra y recibe una lista VACÍA, no un
 *     error. Lo hace la política RLS sobre `person`, no un `WHERE` del endpoint, y por eso
 *     hay que probarlo contra Postgres de verdad y no contra un mock.
 *   - Cualquier rol que no sea el coordinador recibe 403 **en la lectura**. Esta ruta
 *     devuelve el perfil completo, y §4 dice que se elige a una persona sin poder verlo.
 *
 * Lo que el motor prohíbe por su cuenta —DELETE y cambiar `id`— ya está en
 * `immutability.int-spec.ts` y no se repite acá.
 */

const SITE_A = 'a5000000-0000-4000-8000-000000000001';
const SITE_B = 'a5000000-0000-4000-8000-000000000002';

let db: TestDatabase;
let dbService: DbService;
let roster: RosterService;
let accounts: AccountService;
let auth: AuthStack;

let retired: string;

let coordinatorId: string;
let narrowId: string;
let supervisorId: string;
let managementElsewhere: { accountId: string; personId: string };

const asCoordinator = () => ({
  userId: coordinatorId,
  role: 'coordinator' as const,
  siteIds: [SITE_A, SITE_B],
});

/** Un coordinador que solo alcanza la planta A. Es con quien se prueba el borde. */
const asNarrowCoordinator = () => ({
  userId: narrowId,
  role: 'coordinator' as const,
  siteIds: [SITE_A],
});

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  roster = new RosterService(dbService);
  auth = createAuthStack(db.appUrl);
  accounts = new AccountService(auth.db, auth.invitations, auth.sessions);

  await registerSite(db.migrator, SITE_A, 'roster-a', 'Roster A');
  await registerSite(db.migrator, SITE_B, 'roster-b', 'Roster B');

  const coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'coordinator',
  });
  coordinatorId = coordinator.accountId;

  const narrow = await createAccount(db.app, { siteIds: [SITE_A], role: 'coordinator' });
  narrowId = narrow.accountId;

  const supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'inspector' });
  supervisorId = supervisor.accountId;

  const management = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    personSiteId: SITE_B,
    role: 'management',
    firstName: 'Morgan',
    lastName: 'Management',
  });
  managementElsewhere = { accountId: management.accountId, personId: management.personId };
  await inScope(
    db.app,
    [SITE_A, SITE_B],
    'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
    [management.accountId, SITE_B],
  );

  // Apellidos elegidos para que el orden sea comprobable y no coincida con el de alta.
  await createPerson(db.app, SITE_A, {
    employeeNumber: 'RA-3',
    firstName: 'Ada',
    lastName: 'Okafor',
  });
  await createPerson(db.app, SITE_A, {
    employeeNumber: 'RA-1',
    firstName: 'Bruno',
    lastName: 'Alvarez',
  });
  await createPerson(db.app, SITE_A, {
    employeeNumber: 'RA-2',
    firstName: 'Carmen',
    lastName: 'Zeta',
  });
  await createPerson(db.app, SITE_B, {
    employeeNumber: 'RB-1',
    firstName: 'Dana',
    lastName: 'Bright',
  });

  // Una persona dada de baja. La baja se hace acá, a mano, y no por la consola: la consola
  // es de solo lectura, y este spec prueba que sabe MOSTRAR el estado, no ponerlo.
  retired = await createPerson(db.app, SITE_A, {
    employeeNumber: 'RA-9',
    firstName: 'Elena',
    lastName: 'Ibarra',
  });
  await inScope(db.app, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [
    retired,
  ]);
}, 180_000);

afterAll(async () => {
  await dbService.onModuleDestroy();
  await auth.stop();
  await db.stop();
});

describe('leer el roster de una planta', () => {
  it('devuelve a su gente por apellido, y a nadie de la otra planta', async () => {
    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });

    // Solo las del roster: las cuentas sembradas también dejan su persona en A, y lo que
    // se prueba acá es el orden, no cuánta gente hay.
    const mine = rows.filter((row) => row.employee_number.startsWith('RA-'));
    expect(mine.map((row) => row.last_name)).toEqual(['Alvarez', 'Okafor', 'Zeta']);

    expect(rows.map((row) => row.employee_number)).not.toContain('RB-1');
    expect(rows.find((row) => row.id === managementElsewhere.personId)?.site_id).toBe(SITE_B);
    expect(rows.every((row) => row.site_id === SITE_A || row.id === managementElsewhere.personId)).toBe(
      true,
    );
  });

  it('devuelve el roster de la otra planta cuando se lo pide', async () => {
    const rows = await roster.list(asCoordinator(), { site_id: SITE_B, status: 'active' });

    expect(rows.map((row) => row.employee_number)).toContain('RB-1');
    expect(rows.map((row) => row.employee_number)).not.toContain('RA-1');
  });

  it('una planta fuera del alcance devuelve vacío, no un error — RLS, sin WHERE de seguridad', async () => {
    const rows = await roster.list(asNarrowCoordinator(), { site_id: SITE_B, status: 'all' });

    expect(rows).toEqual([]);
  });

  it('incluye management basado en otra planta solo en el roster del sitio con alcance', async () => {
    const rows = await roster.list(asNarrowCoordinator(), { site_id: SITE_A, status: 'active' });

    expect(rows.filter((row) => row.id === managementElsewhere.personId)).toHaveLength(1);
    expect(rows.find((row) => row.id === managementElsewhere.personId)).toMatchObject({
      site_id: SITE_B,
      account: { id: managementElsewhere.accountId, role: 'management' },
    });
    expect(
      await roster.list(asNarrowCoordinator(), { site_id: SITE_B, status: 'active' }),
    ).toEqual([]);
  });

  it('lista una sola vez al mismo management en cada sitio de su alcance', async () => {
    const inA = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const inB = await roster.list(asCoordinator(), { site_id: SITE_B, status: 'active' });

    expect(inA.filter((row) => row.id === managementElsewhere.personId)).toHaveLength(1);
    expect(inB.filter((row) => row.id === managementElsewhere.personId)).toHaveLength(1);
  });

  it('rechaza desde el sitio externo los writes de persona y cuenta', async () => {
    await expect(
      roster.update(asNarrowCoordinator(), managementElsewhere.personId, { first_name: 'No cambia' }),
    ).rejects.toMatchObject({ response: { code: 'person_not_found' } });

    const requests = [
      { request: { promote_to: 'coordinator' as const }, code: 'account_promotion_forbidden' },
      { request: { demote_to: 'inspector' as const }, code: 'account_demotion_forbidden' },
      { request: { invite: true as const }, code: 'account_not_found' },
      { request: { deactivated: true as const }, code: 'account_not_found' },
    ];

    for (const { request, code } of requests) {
      await expect(
        accounts.update(asNarrowCoordinator(), managementElsewhere.accountId, request),
      ).rejects.toMatchObject({ code });
    }

    const stored = await inScope<{ role: string; deactivated_at: Date | null }>(
      db.migrator,
      [SITE_A, SITE_B],
      'SELECT role, deactivated_at FROM app_user WHERE id = $1',
      [managementElsewhere.accountId],
    );
    expect(stored[0]).toMatchObject({ role: 'management', deactivated_at: null });
  });

  it('deja de listar management cuando se revoca su alcance sobre el sitio', async () => {
    await inScope(
      db.app,
      [SITE_A, SITE_B],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
      [managementElsewhere.accountId, SITE_A],
    );

    const rows = await roster.list(asNarrowCoordinator(), { site_id: SITE_A, status: 'active' });

    expect(rows.map((row) => row.id)).not.toContain(managementElsewhere.personId);
  });

  it('lo niega a cualquier rol que no sea el coordinador, también en la lectura', async () => {
    for (const role of ['inspector']) {
      await expect(
        roster.list(
          { userId: supervisorId, role, siteIds: [SITE_A] },
          { site_id: SITE_A, status: 'active' },
        ),
      ).rejects.toMatchObject({ response: { code: 'roster_forbidden' } });
    }
  });
});

describe('el filtro de estado', () => {
  it('`active` deja afuera a las dadas de baja', async () => {
    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });

    expect(rows.map((row) => row.id)).not.toContain(retired);
  });

  it('`inactive` devuelve solo esas, con su `deactivated_at`', async () => {
    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'inactive' });

    expect(rows.map((row) => row.id)).toContain(retired);
    expect(rows.every((row) => row.deactivated_at !== null)).toBe(true);
  });

  it('`all` devuelve las dos', async () => {
    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'all' });
    const numbers = rows.map((row) => row.employee_number);

    expect(numbers).toContain('RA-9');
    expect(numbers).toContain('RA-1');
  });

  /**
   * La consola es el ÚNICO lugar donde una persona dada de baja se ve. El selector de
   * sujeto —lo que alimenta el paquete de campo y el reporte de incidentes— sigue sin
   * ofrecerla, y que las dos lecturas convivan sin contaminarse es la propiedad que separa
   * a esta ruta de aquella.
   */
  it('mostrarla acá no la devuelve a ningún selector', async () => {
    const selectable = await selectablePeople(db.app, [SITE_A]);

    expect(selectable.map((row) => row.id)).not.toContain(retired);
  });
});

describe('dar de baja un worker desde su fila', () => {
  it('marca deactivated_at, lo saca del roster activo y deja que el motor audite', async () => {
    const id = await createPerson(db.app, SITE_A, {
      employeeNumber: 'RA-D1',
      firstName: 'Worker',
      lastName: 'Retirable',
    });

    const result = await roster.deactivate(asCoordinator(), id);

    expect(result.id).toBe(id);
    expect(result.deactivated_at).not.toBeNull();
    expect(
      (await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' })).map(
        (person) => person.id,
      ),
    ).not.toContain(id);
    expect(
      (await roster.list(asCoordinator(), { site_id: SITE_A, status: 'inactive' })).map(
        (person) => person.id,
      ),
    ).toContain(id);

    const events = await inScope<{ event_type: string }>(
      db.migrator,
      [SITE_A],
      `SELECT event_type FROM audit_log
        WHERE payload->>'person_id' = $1
        ORDER BY occurred_at, id`,
      [id],
    );
    expect(events.map((event) => event.event_type)).toEqual([
      'person.created',
      'person.deactivated',
    ]);
  });

  it('rechaza una persona cuya cuenta sigue activa', async () => {
    const linked = await createAccount(db.app, {
      role: 'inspector',
      siteIds: [SITE_A],
      lastName: 'ConCuenta',
    });

    await expect(roster.deactivate(asCoordinator(), linked.personId)).rejects.toMatchObject({
      response: { code: 'person_has_active_account' },
    });
  });

  it('permite la baja si la cuenta asociada ya está inactiva y no la modifica', async () => {
    const linked = await createAccount(db.app, {
      role: 'inspector',
      siteIds: [SITE_A],
      lastName: 'CuentaInactiva',
    });
    await inScope(db.app, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      linked.accountId,
    ]);
    const [before] = await inScope<{ deactivated_at: Date }>(
      db.migrator,
      [SITE_A],
      'SELECT deactivated_at FROM app_user WHERE id = $1',
      [linked.accountId],
    );

    const result = await roster.deactivate(asCoordinator(), linked.personId);

    const [after] = await inScope<{ deactivated_at: Date }>(
      db.migrator,
      [SITE_A],
      'SELECT deactivated_at FROM app_user WHERE id = $1',
      [linked.accountId],
    );
    expect(result.deactivated_at).not.toBeNull();
    expect(after?.deactivated_at.toISOString()).toBe(before?.deactivated_at.toISOString());
  });

  it('rechaza una segunda baja y conserva el momento original', async () => {
    const id = await createPerson(db.app, SITE_A, { lastName: 'DosVeces' });
    const first = await roster.deactivate(asCoordinator(), id);

    await expect(roster.deactivate(asCoordinator(), id)).rejects.toMatchObject({
      response: { code: 'person_not_active' },
    });

    const [stored] = await inScope<{ deactivated_at: Date }>(
      db.migrator,
      [SITE_A],
      'SELECT deactivated_at FROM person WHERE id = $1',
      [id],
    );
    expect(stored?.deactivated_at.toISOString()).toBe(first.deactivated_at);
  });

  it('no distingue una persona fuera del alcance de una inexistente', async () => {
    const outside = await createPerson(db.app, SITE_B, { lastName: 'Fuera' });
    const missing = 'a5000000-0000-4000-8000-000000000099';

    for (const id of [outside, missing]) {
      await expect(roster.deactivate(asNarrowCoordinator(), id)).rejects.toMatchObject({
        response: { code: 'person_not_found' },
      });
    }
  });

  it('lo niega a cualquier rol que no sea el coordinador', async () => {
    const id = await createPerson(db.app, SITE_A, { lastName: 'Protegida' });

    for (const role of ['inspector']) {
      await expect(
        roster.deactivate({ userId: supervisorId, role, siteIds: [SITE_A] }, id),
      ).rejects.toMatchObject({ response: { code: 'roster_forbidden' } });
    }
  });
});

describe('corregir una persona activa desde su fila', () => {
  it('corrige nombre y número dentro del alcance, conservando el id', async () => {
    const id = await createPerson(db.app, SITE_A, {
      employeeNumber: 'RA-CORRECT-OLD',
      firstName: 'Original',
      lastName: 'Nombre',
    });

    const result = await roster.update(asCoordinator(), id, {
      first_name: 'Corregida',
      employee_number: 'RA-CORRECT-NEW',
    });

    expect(result).toMatchObject({
      id,
      first_name: 'Corregida',
      last_name: 'Nombre',
      employee_number: 'RA-CORRECT-NEW',
      site_id: SITE_A,
      deactivated_at: null,
    });
  });

  it('rechaza un número duplicado sin cambiar ni auditar a la persona', async () => {
    const target = await createPerson(db.app, SITE_A, {
      employeeNumber: 'RA-DUP-TARGET',
      lastName: 'Target',
    });
    await createPerson(db.app, SITE_A, { employeeNumber: 'RA-DUP-TAKEN' });

    await expect(
      roster.update(asCoordinator(), target, { employee_number: 'RA-DUP-TAKEN' }),
    ).rejects.toMatchObject({ response: { code: 'person_employee_number_taken' } });

    const person = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'all' });
    expect(person.find((row) => row.id === target)).toMatchObject({
      employee_number: 'RA-DUP-TARGET',
      last_name: 'Target',
    });

    const events = await inScope<{ event_type: string }>(
      db.migrator,
      [SITE_A],
      `SELECT event_type FROM audit_log WHERE payload->>'person_id' = $1 ORDER BY seq`,
      [target],
    );
    expect(events.map((event) => event.event_type)).toEqual(['person.created']);
  });

  it('rechaza a una persona inactiva', async () => {
    const id = await createPerson(db.app, SITE_A, { employeeNumber: 'RA-INACTIVE-EDIT' });
    await inScope(db.app, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [id]);

    await expect(roster.update(asCoordinator(), id, { last_name: 'No cambia' })).rejects.toMatchObject({
      response: { code: 'person_not_active' },
    });
  });

  it('trata una persona de otro sitio como inexistente', async () => {
    const outside = await createPerson(db.app, SITE_B, { employeeNumber: 'RB-EDIT-OUTSIDE' });

    await expect(
      roster.update(asNarrowCoordinator(), outside, { last_name: 'No se revela' }),
    ).rejects.toMatchObject({ response: { code: 'person_not_found' } });
  });

  it('lo niega a un inspector', async () => {
    const id = await createPerson(db.app, SITE_A, { employeeNumber: 'RA-EDIT-ROLE' });

    await expect(
      roster.update(
        { userId: supervisorId, role: 'inspector', siteIds: [SITE_A] },
        id,
        { first_name: 'No autorizado' },
      ),
    ).rejects.toMatchObject({ response: { code: 'roster_forbidden' } });
  });

  it('no escribe auditoría si todos los valores son iguales', async () => {
    const id = await createPerson(db.app, SITE_A, {
      employeeNumber: 'RA-EQUAL',
      firstName: 'Same',
      lastName: 'Values',
    });

    await roster.update(asCoordinator(), id, {
      first_name: 'Same',
      last_name: 'Values',
      employee_number: 'RA-EQUAL',
    });

    const events = await inScope<{ event_type: string }>(
      db.migrator,
      [SITE_A],
      `SELECT event_type FROM audit_log WHERE payload->>'person_id' = $1 ORDER BY seq`,
      [id],
    );
    expect(events.map((event) => event.event_type)).toEqual(['person.created']);
  });
});

describe('la cuenta que viaja junto a cada persona (design D1/D2)', () => {
  it('una persona con cuenta vuelve con su rol', async () => {
    const withAccount = await createAccount(db.app, {
      role: 'inspector',
      siteIds: [SITE_A],
      firstName: 'Fatima',
      lastName: 'Bello',
    });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const row = rows.find((entry) => entry.id === withAccount.personId);

    expect(row?.account).toMatchObject({ id: withAccount.accountId, role: 'inspector' });
  });

  it('una persona sin cuenta vuelve con null, sin error', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'SinCuenta' });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const row = rows.find((entry) => entry.id === person);

    expect(row?.account).toBeNull();
  });

  it('cada cuenta trae su email, y ninguna trae alcance ni token', async () => {
    await createAccount(db.app, { role: 'management', siteIds: [SITE_A], lastName: 'Privado' });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const withAccounts = rows.filter((row) => row.account !== null);

    expect(withAccounts.length).toBeGreaterThan(0);
    for (const row of withAccounts) {
      expect(row.account?.email).toMatch(/@/);
      expect(row.account).not.toHaveProperty('scope');
      expect(row.account).not.toHaveProperty('token');
    }
  });

  it('una cuenta invitada y no aceptada vuelve con can_sign_in en falso, y en verdadero después de aceptar', async () => {
    const invited = await createAccount(db.app, {
      role: 'inspector',
      siteIds: [SITE_A],
      lastName: 'Pendiente',
    });

    const before = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    expect(before.find((row) => row.id === invited.personId)?.account).toMatchObject({
      can_sign_in: false,
    });

    await grantCredential(
      auth,
      { userId: coordinatorId, role: 'coordinator' },
      invited.accountId,
      'a-long-enough-password',
    );

    const after = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    expect(after.find((row) => row.id === invited.personId)?.account).toMatchObject({
      can_sign_in: true,
    });
  });
});
