import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbService } from '../src/db/db.service';
import { RosterService } from '../src/roster/roster.service';
import { registerSite } from './helpers/catalog';
import { createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount, createPerson, selectablePeople } from './helpers/identity';
import { inScope, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * La consola del roster: leer quién trabaja en cada planta. **Solo lectura.**
 *
 * LAS DOS PRUEBAS QUE JUSTIFICAN EL ARCHIVO son las dos mitades del aislamiento:
 *
 *   - Un alcance de una planta pide el roster de la otra y recibe una lista VACÍA, no un
 *     error. Lo hace la política RLS sobre `person`, no un `WHERE` del endpoint, y por eso
 *     hay que probarlo contra Postgres de verdad y no contra un mock.
 *   - Cualquier rol que no sea el coordinador recibe 403 **en la lectura**. Esta ruta
 *     devuelve el perfil completo, y §4 dice que se elige a una persona sin poder verlo.
 *
 * Lo que el motor prohíbe por su cuenta —DELETE, cambiar `employee_number`— ya está en
 * `immutability.int-spec.ts` y no se repite acá.
 */

const SITE_A = 'a5000000-0000-4000-8000-000000000001';
const SITE_B = 'a5000000-0000-4000-8000-000000000002';

let db: TestDatabase;
let dbService: DbService;
let roster: RosterService;
let auth: AuthStack;

let retired: string;

let coordinatorId: string;
let narrowId: string;
let supervisorId: string;

const asCoordinator = () => ({
  userId: coordinatorId,
  role: 'hs_coordinator',
  siteIds: [SITE_A, SITE_B],
});

/** Un coordinador que solo alcanza la planta A. Es con quien se prueba el borde. */
const asNarrowCoordinator = () => ({
  userId: narrowId,
  role: 'hs_coordinator',
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

  await registerSite(db.migrator, SITE_A, 'roster-a', 'Roster A');
  await registerSite(db.migrator, SITE_B, 'roster-b', 'Roster B');

  const coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
  });
  coordinatorId = coordinator.accountId;

  const narrow = await createAccount(db.app, { siteIds: [SITE_A], role: 'hs_coordinator' });
  narrowId = narrow.accountId;

  const supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  supervisorId = supervisor.accountId;

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
    expect(rows.every((row) => row.site_id === SITE_A)).toBe(true);
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

  it('lo niega a cualquier rol que no sea el coordinador, también en la lectura', async () => {
    for (const role of ['supervisor', 'jhsc_member', 'management', 'external_auditor']) {
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

describe('la cuenta que viaja junto a cada persona (design D1/D2)', () => {
  it('una persona con cuenta vuelve con su rol', async () => {
    const withAccount = await createAccount(db.app, {
      role: 'jhsc_member',
      siteIds: [SITE_A],
      firstName: 'Fatima',
      lastName: 'Bello',
    });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const row = rows.find((entry) => entry.id === withAccount.personId);

    expect(row?.account).toMatchObject({ id: withAccount.accountId, role: 'jhsc_member' });
  });

  it('una persona sin cuenta vuelve con null, sin error', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'SinCuenta' });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const row = rows.find((entry) => entry.id === person);

    expect(row?.account).toBeNull();
  });

  it('ninguna respuesta trae email, alcance ni token', async () => {
    await createAccount(db.app, { role: 'supervisor', siteIds: [SITE_A], lastName: 'Privado' });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    const withAccounts = rows.filter((row) => row.account !== null);

    expect(withAccounts.length).toBeGreaterThan(0);
    for (const row of withAccounts) {
      expect(row.account).not.toHaveProperty('email');
      expect(row.account).not.toHaveProperty('scope');
      expect(row.account).not.toHaveProperty('token');
    }
  });

  it('una cuenta invitada y no aceptada vuelve con can_sign_in en falso, y en verdadero después de aceptar', async () => {
    const invited = await createAccount(db.app, {
      role: 'jhsc_member',
      siteIds: [SITE_A],
      lastName: 'Pendiente',
    });

    const before = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    expect(before.find((row) => row.id === invited.personId)?.account).toMatchObject({
      can_sign_in: false,
    });

    await grantCredential(
      auth,
      { userId: coordinatorId, role: 'hs_coordinator' },
      invited.accountId,
      'a-long-enough-password',
    );

    const after = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    expect(after.find((row) => row.id === invited.personId)?.account).toMatchObject({
      can_sign_in: true,
    });
  });
});
