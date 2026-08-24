import {
  locationPackageSchema,
  rosterPackageSchema,
  templateDocumentSchema,
  templateVersionPackageSchema,
  type TemplateDocument,
} from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocation, registerSite } from './helpers/catalog';
import { createAccount, createPerson } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * El paquete de campo: las tres lecturas que el dispositivo hace ANTES de perder señal.
 *
 * Lo que estos tests prueban no es que las consultas devuelvan filas —eso lo prueba
 * cualquier smoke test— sino las tres propiedades que el requisito exige y que se
 * pierden en silencio si nadie las mira: que la versión servida es la CONGELADA, que lo
 * desactivado no se ofrece, y que el aislamiento por planta sigue siendo de la política
 * RLS y no del `WHERE` de selección.
 */

const SITE_A = '9c000000-0000-4000-8000-000000000001';
const SITE_B = '9c000000-0000-4000-8000-000000000002';

const NOWHERE = '9c000000-0000-4000-8000-0000000000ff';

let db: TestDatabase;
let stack: SchedulingStack;

let templateId: string;
let versionV2: string;
let versionV3: string;
let inspectionA: string;
let inspectionB: string;

let inspector: { accountId: string };
let otherInspector: { accountId: string };
let outsider: { accountId: string };
let coordinator: { accountId: string };

/** Una sesión con el alcance dado. Es lo único que el servicio acepta como actor. */
function sessionFor(accountId: string, siteIds: string[], role = 'jhsc_member') {
  return { userId: accountId, role, siteIds };
}

function documentFor(itemKey: string, prompt: string): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: itemKey,
            prompt,
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createSchedulingStack(db.appUrl);

  await registerSite(db.migrator, SITE_A, 'package-a');
  await registerSite(db.migrator, SITE_B, 'package-b');

  templateId = await createTemplate(db.migrator, 'package-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ['pkg.guard']);

  // Se publica la v1 y la v2; la inspección se ata a la v2. La v3 llega en su propio
  // test, para que el congelamiento se pruebe contra una publicación posterior real.
  await publishVersion(db.migrator, templateId, 1, documentFor('pkg.guard', 'Version one'));
  versionV2 = await publishVersion(db.migrator, templateId, 2, documentFor('pkg.guard', 'Version two'));

  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  otherInspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  outsider = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });
  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
  });

  inspectionA = await scheduleInspection(db.app, {
    siteId: SITE_A,
    periodStart: '2026-08-01',
    templateId,
    templateVersionId: versionV2,
    inspectorId: inspector.accountId,
  });

  inspectionB = await scheduleInspection(db.app, {
    siteId: SITE_B,
    periodStart: '2026-08-01',
    templateId,
    templateVersionId: versionV2,
  });

  await createLocation(db.app, SITE_A, 'line-3', 'Packaging line 3');
  await createLocation(db.app, SITE_B, 'dock-1', 'Receiving dock 1');

  await createPerson(db.app, SITE_A, { firstName: 'Dana', lastName: 'Okafor' });
  await createPerson(db.app, SITE_B, { firstName: 'Sam', lastName: 'Bright' });
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('el paquete de campo completo', () => {
  it('devuelve las tres piezas y el documento parsea contra el motor', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const version = await stack.inspections.templateVersionPackage(session, inspectionA);
    const locations = await stack.inspections.locationPackage(session, inspectionA);
    const roster = await stack.inspections.rosterPackage(session, inspectionA);

    // Cada respuesta parsea contra el contrato compartido: es el mismo esquema con el
    // que el dispositivo la va a leer, así que un desajuste aparece acá y no en la planta.
    expect(templateVersionPackageSchema.safeParse(version).success).toBe(true);
    expect(locationPackageSchema.safeParse(locations).success).toBe(true);
    expect(rosterPackageSchema.safeParse(roster).success).toBe(true);

    expect(version.site_id).toBe(SITE_A);
    expect(version.template_version_id).toBe(versionV2);
    expect(version.version).toBe(2);
    expect(version.inspector_id).toBe(inspector.accountId);

    // Y el documento es el que el motor de formularios acepta como entrada.
    expect(templateDocumentSchema.safeParse(version.document).success).toBe(true);

    // Membresía y no conteo: `createAccount` da de alta además la persona de cada
    // cuenta, así que la planta tiene más gente que la que este spec sembró a mano. Lo
    // que importa es que esté la suya y no la de la otra planta.
    expect(locations.map((row) => row.code)).toEqual(['line-3']);
    expect(roster.map((row) => row.last_name)).toContain('Okafor');
    expect(roster.map((row) => row.last_name)).not.toContain('Bright');
  });

  /**
   * Las tres son independientes: la del roster se puede repetir sola. Es lo que hace que
   * una descarga previa parcial se complete sin volver a bajar el documento, que es la
   * pieza cara.
   */
  it('cada lectura es independiente de las otras', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const first = await stack.inspections.rosterPackage(session, inspectionA);
    const second = await stack.inspections.rosterPackage(session, inspectionA);

    expect(second).toEqual(first);
  });
});

describe('el aislamiento', () => {
  /**
   * La primera mitad de D3: SIN alcance no se ve nada. Esto lo hace la política RLS —la
   * inspección no aparece en la transacción— y no un `WHERE` del endpoint.
   */
  it('una cuenta sin alcance en la planta recibe inspection_not_found en las tres rutas', async () => {
    const session = sessionFor(outsider.accountId, [SITE_B]);

    await expect(
      stack.inspections.templateVersionPackage(session, inspectionA),
    ).rejects.toMatchObject({ status: 404 });

    await expect(stack.inspections.locationPackage(session, inspectionA)).rejects.toMatchObject({
      status: 404,
    });

    await expect(stack.inspections.rosterPackage(session, inspectionA)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('una inspección inexistente se refuta igual que una fuera de alcance', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);

    await expect(
      stack.inspections.templateVersionPackage(session, NOWHERE),
    ).rejects.toMatchObject({ status: 404 });
  });

  /**
   * La segunda mitad de D3: CON alcance a las dos plantas, el `WHERE site_id` elige la
   * correcta. Acá la política no recorta nada —el coordinador puede leer las dos— así
   * que lo que se prueba es el filtro de selección, que es un requisito de producto y no
   * de seguridad.
   */
  it('un coordinador con las dos plantas recibe solo lo de la planta de la inspección', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator');

    const locationsB = await stack.inspections.locationPackage(session, inspectionB);
    const rosterB = await stack.inspections.rosterPackage(session, inspectionB);

    expect(locationsB.map((row) => row.code)).toEqual(['dock-1']);
    expect(rosterB.map((row) => row.last_name)).toContain('Bright');
    expect(rosterB.map((row) => row.last_name)).not.toContain('Okafor');

    // Y la MISMA sesión, sobre la inspección de la otra planta, recibe la otra lista.
    // Es la prueba del filtro de selección: el alcance no cambió entre las dos llamadas,
    // solo cambió la inspección.
    const locationsA = await stack.inspections.locationPackage(session, inspectionA);
    const rosterA = await stack.inspections.rosterPackage(session, inspectionA);

    expect(locationsA.map((row) => row.code)).toEqual(['line-3']);
    expect(rosterA.map((row) => row.last_name)).toContain('Okafor');
    expect(rosterA.map((row) => row.last_name)).not.toContain('Bright');
  });

  /**
   * `inspector_id` es un dato que viaja en el paquete, no un recorte de quién puede
   * leerlo (proposal `device-refuses-unassigned-capture`). El coordinador no es el
   * inspector asignado a `inspectionA` y aun así la lectura tiene que devolverle quién
   * lo es — la comprobación que le importa a esta ruta sigue siendo el alcance de sitio.
   */
  it('una cuenta que no es la asignada igual lee el paquete, con el inspector que corresponde', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator');

    const version = await stack.inspections.templateVersionPackage(session, inspectionA);

    expect(version.inspector_id).toBe(inspector.accountId);
  });

  /** `inspectionB` se programó sin inspector (línea de arriba: sin `inspectorId`). */
  it('una inspección sin inspector sirve inspector_id en null', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator');

    const version = await stack.inspections.templateVersionPackage(session, inspectionB);

    expect(version.inspector_id).toBeNull();
  });
});

describe('el congelamiento de la versión', () => {
  /**
   * La garantía central de `inspections`, verificada del lado del servidor: publicar la
   * v3 no mueve una inspección atada a la v2. Si esta ruta resolviera "la más alta
   * publicada", el inspector recorrería contra un formulario que no es el que se le
   * asignó y el envío se validaría contra otro.
   */
  it('publicar una versión más alta no cambia lo que se sirve', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const before = await stack.inspections.templateVersionPackage(session, inspectionA);
    expect(before.version).toBe(2);

    versionV3 = await publishVersion(
      db.migrator,
      templateId,
      3,
      documentFor('pkg.guard', 'Version three'),
    );

    const after = await stack.inspections.templateVersionPackage(session, inspectionA);

    expect(after.version).toBe(2);
    expect(after.template_version_id).toBe(versionV2);
    expect(after.document).toEqual(before.document);
    expect(JSON.stringify(after.document)).toContain('Version two');
    expect(JSON.stringify(after.document)).not.toContain('Version three');
  });

  it('el POST de avance devuelve la versión nueva y es idempotente', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const first = await stack.inspections.advanceTemplateVersion(session, inspectionA);
    const second = await stack.inspections.advanceTemplateVersion(session, inspectionA);

    expect(first.template_version_id).toBe(versionV3);
    expect(first.version).toBe(3);
    expect(JSON.stringify(first.document)).toContain('Version three');
    expect(second).toEqual(first);

    const pending = await stack.inspections.pendingFor(session);
    const current = pending.find((entry) => entry.id === inspectionA);
    expect(current).toMatchObject({
      template_version: 3,
      latest_template_version: 3,
      latest_template_version_id: versionV3,
    });

    const entries = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count
         FROM audit_log
        WHERE site_id = $1
          AND event_type = 'inspection.version_advanced'
          AND payload->>'scheduled_inspection_id' = $2`,
      [SITE_A, inspectionA],
    );
    expect(one(entries).count).toBe('1');
  });

  it('rechaza el avance a una cuenta que no es la asignada ni coordinadora', async () => {
    await expect(
      stack.inspections.advanceTemplateVersion(
        sessionFor(otherInspector.accountId, [SITE_A]),
        inspectionA,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('lo desactivado', () => {
  it('una ubicación desactivada no se ofrece, y su fila sigue existiendo', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);
    const retired = await createLocation(db.app, SITE_A, 'line-9', 'Retired line 9');

    expect((await stack.inspections.locationPackage(session, inspectionA)).map((r) => r.code)).toContain(
      'line-9',
    );

    await inScope(db.app, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      retired,
    ]);

    const offered = await stack.inspections.locationPackage(session, inspectionA);
    expect(offered.map((row) => row.code)).not.toContain('line-9');

    // Nunca se borra: se desactiva. La fila sigue resolviendo desde el historial.
    const still = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM location WHERE id = $1',
      [retired],
    );
    expect(one(still).count).toBe('1');
  });

  it('una persona desactivada no se ofrece, y su fila sigue existiendo', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);
    const departed = await createPerson(db.app, SITE_A, {
      firstName: 'Gone',
      lastName: 'Zulu',
    });

    expect(
      (await stack.inspections.rosterPackage(session, inspectionA)).map((r) => r.last_name),
    ).toContain('Zulu');

    await inScope(db.app, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [
      departed,
    ]);

    const offered = await stack.inspections.rosterPackage(session, inspectionA);
    expect(offered.map((row) => row.last_name)).not.toContain('Zulu');

    const still = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM person WHERE id = $1',
      [departed],
    );
    expect(one(still).count).toBe('1');
  });

  /** §4 — el operador elige a una persona sin poder ver su perfil. */
  it('el roster no lleva un campo más que los cuatro del contrato', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);
    const roster = await stack.inspections.rosterPackage(session, inspectionA);

    for (const entry of roster) {
      expect(Object.keys(entry).sort()).toEqual([
        'employee_number',
        'first_name',
        'id',
        'last_name',
      ]);
    }
  });
});

describe('una inspección cancelada', () => {
  it('no sirve paquete de campo en ninguna de las tres rutas', async () => {
    const cancelled = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-07-01',
      templateId,
      templateVersionId: versionV2,
      inspectorId: inspector.accountId,
    });

    await stack.inspections.cancel(
      sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator'),
      cancelled,
      'Plant shut down that week',
    );

    const session = sessionFor(inspector.accountId, [SITE_A]);

    await expect(
      stack.inspections.templateVersionPackage(session, cancelled),
    ).rejects.toMatchObject({ status: 404 });
    await expect(stack.inspections.locationPackage(session, cancelled)).rejects.toMatchObject({
      status: 404,
    });
    await expect(stack.inspections.rosterPackage(session, cancelled)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('las tres rutas no escriben', () => {
  /**
   * Este change no crea ni altera ninguna tabla, y no escribe una sola fila. Leer dos
   * veces y afirmar que el conteo de las tres tablas no se movió lo hace explícito: si
   * mañana alguien agrega un registro de lectura acá, este test lo dice.
   *
   * (La excepción del sistema a no loguear lecturas es el auditor externo, y este spec
   * no usa esa cuenta a propósito.)
   */
  it('leer el paquete no cambia el estado de la base', async () => {
    const session = sessionFor(inspector.accountId, [SITE_A]);
    const before = await counts();

    await stack.inspections.templateVersionPackage(session, inspectionA);
    await stack.inspections.locationPackage(session, inspectionA);
    await stack.inspections.rosterPackage(session, inspectionA);

    expect(await counts()).toEqual(before);
  });
});

async function counts(): Promise<Record<string, string>> {
  const rows = await inScope<{ locations: string; people: string; audit: string }>(
    db.app,
    [SITE_A, SITE_B],
    `SELECT (SELECT count(*)::text FROM location) AS locations,
            (SELECT count(*)::text FROM person) AS people,
            (SELECT count(*)::text FROM audit_log) AS audit`,
  );

  return one(rows) as unknown as Record<string, string>;
}
