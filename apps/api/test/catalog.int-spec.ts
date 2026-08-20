import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applySeeds } from '../scripts/seed.mjs';
import { DbService } from '../src/db/db.service';
import { LocationsService } from '../src/catalog/locations.service';
import { withSiteScope } from '../src/db/site-scope';
import {
  createLocation,
  locationById,
  registerSite,
  selectableLocations,
  SEEDED_SITES,
  type LocationRow,
} from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, itemRow, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §6 pregunta cerrada 1 — el catálogo de sitios y ubicaciones.
 *
 * Lo que este spec protege no es "que se pueda crear una ubicación": es que las
 * cuatro formas de romper la agrupación por ubicación sean estados imposibles.
 * Borrar una ubicación, moverla de sitio, reescribirle el `code` y referenciar la
 * ubicación de la otra planta no fallan de forma visible si la garantía vive en
 * el formulario — la operación funciona y el reporte miente después.
 */

const SITE_A = '99999999-0000-4000-8000-00000000000a';
const SITE_B = '99999999-0000-4000-8000-00000000000b';
/**
 * Desde 0005, `audit_log.actor_user_id` referencia una cuenta real: un uuid
 * inventado ya no es legal. Lo que cambia es el arranque, no lo que este spec
 * prueba.
 */
const ACTOR = '99999999-0000-4000-8000-0000000000ac';
const ORGANIZATION_LOCATION = '99999999-0000-4000-8000-0000000000ad';

/** insufficient_privilege. También es el SQLSTATE de una violación de política RLS. */
const INSUFFICIENT_PRIVILEGE = '42501';

/** El SQLSTATE propio de los triggers de inmutabilidad (migraciones 0001 y 0004). */
const APPEND_ONLY = 'HS001';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

let db: TestDatabase;
let dbService: DbService;
let locations: LocationsService;

/** Una ubicación de cada sitio, creadas una vez y reusadas por los tests de lectura. */
let dockA: string;
let dockB: string;

/**
 * La fila de ítem contra la que apuntan los hallazgos stand-in. El stub la exige
 * porque en producción un hallazgo siempre resuelve qué pregunta lo originó; acá
 * es irrelevante cuál sea — lo que se prueba es la ubicación.
 */
let versionItemId: string;

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  locations = new LocationsService(dbService);

  const fixture = resolve(dirname(__filename), 'fixtures/finding_stub.sql');
  await db.migrator.query(await readFile(fixture, 'utf8'));

  await registerSite(db.migrator, SITE_A, 'catalog-a', 'Catalog A');
  await registerSite(db.migrator, SITE_B, 'catalog-b', 'Catalog B');

  await createAccount(db.migrator, { id: ACTOR, siteIds: [SITE_A, SITE_B] });

  dockA = await createLocation(db.migrator, SITE_A, 'shipping-dock', 'Shipping dock');
  dockB = await createLocation(db.migrator, SITE_B, 'shipping-dock', 'Shipping dock');
  await inScope(
    db.migrator,
    [],
    'INSERT INTO organization_location (id, code, name) VALUES ($1, $2, $3)',
    [ORGANIZATION_LOCATION, 'shipping-dock', 'Shipping dock'],
  );
  await inScope(
    db.migrator,
    [SITE_A, SITE_B],
    'UPDATE location SET organization_location_id = $1 WHERE id = ANY($2::uuid[])',
    [ORGANIZATION_LOCATION, [dockA, dockB]],
  );

  const templateId = await createTemplate(db.migrator, 'catalog-spec-template');
  await registerItems(db.migrator, templateId, ['guards.packaging-lines']);
  const versionId = await publishVersion(db.migrator, templateId, 1, {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'guards.packaging-lines',
            prompt: 'Machine guards present?',
            position: 1,
            response_type: 'yes_no',
            required: true,
          },
        ],
      },
    ],
  });
  versionItemId = (await itemRow(db.migrator, versionId, 'guards.packaging-lines')).id;
});

afterAll(async () => {
  await dbService?.onModuleDestroy();
  await db?.stop();
});

/** Un `code` único por test, para que ninguno dependa del orden de ejecución. */
let counter = 0;
const uniqueCode = (prefix: string) => `${prefix}-${(counter += 1)}`;

describe('el sitio tiene identidad estable y no se borra', () => {
  it('un code repetido se rechaza', async () => {
    await expect(
      inScope(db.migrator, [], 'INSERT INTO site (code, name) VALUES ($1, $2)', [
        'catalog-a',
        'Otra planta',
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  it('el code no se puede cambiar, ni siquiera como dueño de la tabla', async () => {
    await expect(
      inScope(db.migrator, [], 'UPDATE site SET code = $1 WHERE id = $2', ['catalog-a2', SITE_A]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);

    const rows = await inScope<{ code: string }>(
      db.migrator,
      [],
      'SELECT code FROM site WHERE id = $1',
      [SITE_A],
    );

    expect(one(rows).code).toBe('catalog-a');
  });

  it('el nombre sí se puede corregir', async () => {
    await inScope(db.migrator, [], 'UPDATE site SET name = $1 WHERE id = $2', [
      'Catalog A (renamed)',
      SITE_A,
    ]);

    const rows = await inScope<{ name: string }>(
      db.migrator,
      [],
      'SELECT name FROM site WHERE id = $1',
      [SITE_A],
    );

    expect(one(rows).name).toBe('Catalog A (renamed)');
  });

  it('la aplicación no puede borrar un sitio', async () => {
    await expect(
      inScope(db.app, [], 'DELETE FROM site WHERE id = $1', [SITE_B]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const rows = await inScope(db.migrator, [], 'SELECT id FROM site WHERE id = $1', [SITE_B]);
    expect(rows).toHaveLength(1);
  });

  it('el dueño de la tabla tampoco: lo frena el trigger, no el privilegio', async () => {
    await expect(
      inScope(db.migrator, [], 'DELETE FROM site WHERE id = $1', [SITE_B]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);
  });

  it('la aplicación no puede dar de alta una planta', async () => {
    await expect(
      inScope(db.app, [], 'INSERT INTO site (code, name) VALUES ($1, $2)', ['catalog-c', 'C']),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });
});

describe('una ubicación pertenece a exactamente un sitio', () => {
  // La columna es NOT NULL, pero no es el NOT NULL el que frena: `site_id = ANY
  // (...)` con NULL da NULL, así que el WITH CHECK de la política rechaza la fila
  // antes. Se afirma el error que realmente sale, no el que uno esperaría.
  it('sin sitio, la política lo rechaza antes que el NOT NULL', async () => {
    await expect(
      inScope(db.migrator, [SITE_A], 'INSERT INTO location (site_id, code, name) VALUES (NULL, $1, $2)', [
        uniqueCode('orphan'),
        'Orphan',
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('con un sitio que no existe, se rechaza', async () => {
    const ghost = '99999999-0000-4000-8000-0000000000ff';

    await expect(
      inScope(db.migrator, [ghost], 'INSERT INTO location (site_id, code, name) VALUES ($1, $2, $3)', [
        ghost,
        uniqueCode('ghost'),
        'Ghost',
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });

  // Mover una ubicación de planta reescribiría dónde pasaron los hallazgos que ya
  // la referencian. No es un renombre: es falsificar el registro.
  it('no se puede mover a la otra planta', async () => {
    await expect(
      inScope(db.migrator, [SITE_A, SITE_B], 'UPDATE location SET site_id = $1 WHERE id = $2', [
        SITE_B,
        dockA,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);

    const row = await locationById(db.migrator, [SITE_A], dockA);
    expect(row.site_id).toBe(SITE_A);
  });
});

describe('la identidad es inmutable; la etiqueta y el estado no', () => {
  it('la aplicación puede renombrar', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('line'), 'Packaging line 3');

    await inScope(db.app, [SITE_A], 'UPDATE location SET name = $1 WHERE id = $2', [
      'Packaging line 3 (west)',
      id,
    ]);

    expect((await locationById(db.app, [SITE_A], id)).name).toBe('Packaging line 3 (west)');
  });

  // Dos barreras, dos SQLSTATEs distintos. Que sean distintos es lo que prueba
  // que están las dos y no una sola.
  it('a la aplicación el code se lo niega el privilegio de columna', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'UPDATE location SET code = $1 WHERE id = $2', ['hacked', dockA]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('al dueño de la tabla se lo niega el trigger', async () => {
    await expect(
      inScope(db.migrator, [SITE_A], 'UPDATE location SET code = $1 WHERE id = $2', [
        'hacked',
        dockA,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);

    expect((await locationById(db.migrator, [SITE_A], dockA)).code).toBe('shipping-dock');
  });
});

describe('las ubicaciones se desactivan, nunca se borran', () => {
  it('la aplicación no puede borrar', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM location WHERE id = $1', [dockA]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    expect((await locationById(db.migrator, [SITE_A], dockA)).id).toBe(dockA);
  });

  it('el dueño de la tabla tampoco', async () => {
    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM location WHERE id = $1', [dockA]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);
  });

  it('una desactivada sale del desplegable y sigue existiendo', async () => {
    const code = uniqueCode('retired');
    const id = await createLocation(db.migrator, SITE_A, code, 'Retired area');

    expect((await selectableLocations(db.app, [SITE_A])).map((row) => row.id)).toContain(id);

    await inScope(db.app, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      id,
    ]);

    const offered = await selectableLocations(db.app, [SITE_A]);
    expect(offered.map((row) => row.id)).not.toContain(id);
    expect((await locationById(db.migrator, [SITE_A], id)).name).toBe('Retired area');
  });

  // El requisito que justifica que la baja sea lógica: la inspección de hace dos
  // años sigue diciendo dónde se hizo.
  it('un hallazgo histórico sigue resolviendo una ubicación desactivada', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('old'), 'Old boiler room');
    await recordStubFinding(SITE_A, id);

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      id,
    ]);

    const rows = await inScope<{ code: string; name: string }>(
      db.migrator,
      [SITE_A],
      `SELECT l.code, l.name
         FROM finding_stub f
         JOIN location l ON l.id = f.location_id
        WHERE f.location_id = $1`,
      [id],
    );

    expect(one(rows).name).toBe('Old boiler room');
  });
});

describe('unicidad dentro del sitio', () => {
  it('una ubicación física no puede mapearse dos veces al mismo destino', async () => {
    const second = await createLocation(db.migrator, SITE_A, uniqueCode('second'), 'Second area');

    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        'UPDATE location SET organization_location_id = $1 WHERE id = $2',
        [ORGANIZATION_LOCATION, second],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  it('el code del catálogo global también es inmutable para la aplicación', async () => {
    await expect(
      inScope(db.app, [], 'UPDATE organization_location SET code = $1 WHERE id = $2', [
        'shipping-dock-renamed',
        ORGANIZATION_LOCATION,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('un code repetido en el mismo sitio se rechaza', async () => {
    await expect(
      createLocation(db.migrator, SITE_A, 'shipping-dock', 'Shipping dock (again)'),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  it('el mismo code en la otra planta es otra ubicación', async () => {
    expect(dockA).not.toBe(dockB);
    expect((await locationById(db.migrator, [SITE_B], dockB)).code).toBe('shipping-dock');
  });

  it('dos activas con el mismo nombre se rechazan', async () => {
    const name = 'Cold storage';
    await createLocation(db.migrator, SITE_A, uniqueCode('cold'), name);

    await expect(
      createLocation(db.migrator, SITE_A, uniqueCode('cold'), name),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  // El único es PARCIAL a propósito: sin eso, un nombre dado de baja hace tres
  // años quedaría quemado para siempre.
  it('un nombre liberado por una baja se puede volver a usar', async () => {
    const name = 'Boiler room';
    const first = await createLocation(db.migrator, SITE_A, uniqueCode('boiler'), name);

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      first,
    ]);

    const second = await createLocation(db.migrator, SITE_A, uniqueCode('boiler'), name);

    expect(second).not.toBe(first);
  });

  it('reactivar sobre un nombre ya tomado se rechaza', async () => {
    const name = 'Maintenance shop';
    const first = await createLocation(db.migrator, SITE_A, uniqueCode('shop'), name);

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      first,
    ]);
    await createLocation(db.migrator, SITE_A, uniqueCode('shop'), name);

    await expect(
      inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = NULL WHERE id = $1', [
        first,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });
});

describe('el catálogo está aislado por sitio', () => {
  it('con alcance de un sitio se ve solo ese catálogo', async () => {
    const rows = await selectableLocations(db.app, [SITE_A]);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.site_id === SITE_A)).toBe(true);
    expect(rows.map((row) => row.id)).not.toContain(dockB);
  });

  it('con alcance de los dos sitios se ven los dos catálogos', async () => {
    const rows = await selectableLocations(db.app, [SITE_A, SITE_B]);
    const sites = new Set(rows.map((row) => row.site_id));

    expect(sites).toEqual(new Set([SITE_A, SITE_B]));
  });

  /**
   * La forma de fallar de este bug es "el catálogo se ve vacío", no un error. Se
   * afirma explícitamente para que quede escrita antes de que alguien la
   * encuentre en una pantalla.
   */
  it('sin alcance declarado no se ve nada, y no falla', async () => {
    const rows = await inScope<LocationRow>(db.app, [], 'SELECT id FROM location');

    expect(rows).toEqual([]);
  });

  it('insertar fuera del alcance lo rechaza la política', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'INSERT INTO location (site_id, code, name) VALUES ($1, $2, $3)', [
        SITE_B,
        uniqueCode('smuggled'),
        'Smuggled',
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  // FORCE ROW LEVEL SECURITY. Sin él, el dueño de la tabla evade sus propias
  // políticas y el aislamiento no aplica al rol que corre las migraciones.
  it('el dueño de la tabla tampoco evade la política', async () => {
    const rows = await selectableLocations(db.migrator, [SITE_A]);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.site_id === SITE_A)).toBe(true);
  });

  it('withSiteScope no arrastra el alcance entre transacciones de la misma conexión', async () => {
    const single = db.singleConnectionApp();

    const inside = await withSiteScope(single, { siteIds: [SITE_A] }, async (client) =>
      client.query('SELECT id FROM location'),
    );
    const outside = await withSiteScope(single, { siteIds: [] }, async (client) =>
      client.query('SELECT id FROM location'),
    );

    expect(inside.rowCount).toBeGreaterThan(0);
    expect(outside.rowCount).toBe(0);
  });
});

/** Registra un hallazgo stand-in en el sitio y la ubicación dados. */
async function recordStubFinding(siteId: string, locationId: string): Promise<void> {
  await inScope(
    db.migrator,
    [siteId],
    `INSERT INTO finding_stub (template_version_item_id, item_key, site_id, location_id)
     VALUES ($1, NULL, $2, $3)`,
    [versionItemId, siteId, locationId],
  );
}

describe('un registro no puede tomar prestada la ubicación de la otra planta', () => {
  it('la referencia cruzada se rechaza con violación de FK', async () => {
    await expect(recordStubFinding(SITE_A, dockB)).rejects.toSatisfy(
      (error) => sqlstate(error) === FOREIGN_KEY_VIOLATION,
    );
  });

  it('la referencia del mismo sitio se acepta', async () => {
    await expect(recordStubFinding(SITE_A, dockA)).resolves.not.toThrow();
  });
});

describe('los cambios del catálogo quedan auditados', () => {
  /** Las entradas del log de un sitio, de la más nueva a la más vieja. */
  async function entriesFor(siteId: string, locationId: string) {
    return inScope<{ event_type: string; payload: Record<string, unknown>; actor_user_id: string | null }>(
      db.migrator,
      [siteId],
      `SELECT event_type, payload, actor_user_id
         FROM audit_log
        WHERE site_id = $1 AND payload ->> 'location_id' = $2
        ORDER BY seq`,
      [siteId, locationId],
    );
  }

  it('el alta escribe una entrada con el code', async () => {
    const code = uniqueCode('audited');
    const id = await createLocation(db.migrator, SITE_A, code, 'Audited area');

    const entries = await entriesFor(SITE_A, id);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.event_type).toBe('location.created');
    expect(entries[0]!.payload.code).toBe(code);
  });

  it('el renombre escribe el nombre anterior y el nuevo', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('renamed'), 'Before');

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET name = $1 WHERE id = $2', [
      'After',
      id,
    ]);

    const [, renamed] = await entriesFor(SITE_A, id);

    expect(renamed!.event_type).toBe('location.renamed');
    expect(renamed!.payload.previous_name).toBe('Before');
    expect(renamed!.payload.name).toBe('After');
  });

  it('la baja y la reactivación son dos eventos distintos', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('cycled'), 'Cycled area');

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      id,
    ]);
    await inScope(db.migrator, [SITE_A], 'UPDATE location SET deactivated_at = NULL WHERE id = $1', [
      id,
    ]);

    const events = (await entriesFor(SITE_A, id)).map((entry) => entry.event_type);

    expect(events).toEqual(['location.created', 'location.deactivated', 'location.reactivated']);
  });

  it('un update que no cambia nada observable no escribe nada', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('noop'), 'Noop area');

    await inScope(db.migrator, [SITE_A], 'UPDATE location SET name = name WHERE id = $1', [id]);

    expect(await entriesFor(SITE_A, id)).toHaveLength(1);
  });

  it('el actor sale del alcance de la transacción', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('actor'), 'Actor area');

    await withSiteScope(db.app, { siteIds: [SITE_A], userId: ACTOR }, (client) =>
      client.query('UPDATE location SET name = $1 WHERE id = $2', ['Actor area (renamed)', id]),
    );

    const [, renamed] = await entriesFor(SITE_A, id);

    expect(renamed!.actor_user_id).toBe(ACTOR);
  });

  it('un cambio en una transacción abortada no deja entrada', async () => {
    const id = await createLocation(db.migrator, SITE_A, uniqueCode('rolled'), 'Rolled back area');
    const client = await db.migrator.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', SITE_A]);
      await client.query('UPDATE location SET name = $1 WHERE id = $2', ['Never happened', id]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await entriesFor(SITE_A, id)).toHaveLength(1);
    expect((await locationById(db.migrator, [SITE_A], id)).name).toBe('Rolled back area');
  });

  it('una entrada de un sitio que no existe se rechaza', async () => {
    const ghost = '99999999-0000-4000-8000-0000000000fe';

    await expect(
      inScope(
        db.migrator,
        [ghost],
        `INSERT INTO audit_log (site_id, event_type, payload, occurred_at, recorded_at, hash)
         VALUES ($1, 'test.event', '{}'::jsonb, now(), now(), ''::bytea)`,
        [ghost],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });

  // La FK que agrega 0004 no entra en `hs_audit_canonical`, así que ningún hash
  // cambia: la cadena de los dos sitios sigue verificando después de que el
  // catálogo escribió sus propios eventos.
  it('la cadena de los dos sitios sigue intacta', async () => {
    for (const siteId of [SITE_A, SITE_B]) {
      const broken = await inScope(
        db.migrator,
        [siteId],
        'SELECT * FROM hs_audit_verify_chain($1)',
        [siteId],
      );

      expect(broken).toEqual([]);
    }
  });
});

describe('el catálogo se carga por seed', () => {
  it('sembrar dos veces deja una sola copia', async () => {
    await applySeeds(db.migrator);
    const first = await counts();

    await applySeeds(db.migrator);
    const second = await counts();

    expect(second).toEqual(first);
  });

  it('las dos plantas quedan sembradas con sus ids fijos', async () => {
    const rows = await inScope<{ id: string; code: string; deactivated_at: Date | null }>(
      db.migrator,
      [],
      "SELECT id, code, deactivated_at FROM site WHERE code IN ('st-thomas', 'glencoe') ORDER BY code",
    );

    expect(rows.map((row) => row.code)).toEqual(['glencoe', 'st-thomas']);
    expect(rows.map((row) => row.id).sort()).toEqual(
      [SEEDED_SITES.glencoe, SEEDED_SITES.stThomas].sort(),
    );
    expect(rows.every((row) => row.deactivated_at === null)).toBe(true);
  });

  it('cada planta arranca con un catálogo usable', async () => {
    for (const siteId of Object.values(SEEDED_SITES)) {
      const rows = await selectableLocations(db.migrator, [siteId]);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.code.length > 0 && row.name.length > 0)).toBe(true);
    }
  });

  /** Cuántas filas de catálogo hay, con las dos plantas sembradas en el alcance. */
  async function counts() {
    const rows = await inScope<{ sites: number; locations: number }>(
      db.migrator,
      Object.values(SEEDED_SITES),
      `SELECT (SELECT count(*)::int FROM site) AS sites,
              (SELECT count(*)::int FROM location) AS locations`,
    );

    return one(rows);
  }
});

/**
 * El alta desde la consola del coordinador.
 *
 * §6 ya decía que «adding one is a catalogue operation» y hasta acá no había ninguna: las
 * ubicaciones entraban solo por seed, así que registrar una máquina nueva era editar SQL y
 * desplegar. Estos tests cubren las dos altas contra Postgres de verdad, porque lo que hay
 * que probar es qué hace cada único cuando choca —y eso no lo sabe ningún mock.
 */
describe('dar de alta desde la consola', () => {
  const asCoordinator = () => ({
    userId: ACTOR,
    role: 'hs_coordinator',
    siteIds: [SITE_A, SITE_B],
  });

  it('crea una ubicación compartida, sin planta', async () => {
    const code = uniqueCode('org-new');
    const created = await locations.createOrganizationLocation(asCoordinator(), {
      code,
      name: 'Brand new',
    });

    expect(created.code).toBe(code);
    expect(created.deactivated_at).toBeNull();
    expect(created).not.toHaveProperty('site_id');
  });

  it('rechaza una compartida con un code ya tomado', async () => {
    const code = uniqueCode('org-dup');
    await locations.createOrganizationLocation(asCoordinator(), { code, name: 'First' });

    await expect(
      locations.createOrganizationLocation(asCoordinator(), { code, name: 'Second' }),
    ).rejects.toThrow(/already in use/);
  });

  it('crea una ubicación física en la planta de la ruta, sin mapear', async () => {
    const code = uniqueCode('loc-new');
    const created = await locations.createLocation(asCoordinator(), SITE_A, {
      code,
      name: `Boiler room ${code}`,
    });

    expect(created.site_id).toBe(SITE_A);
    expect(created.organization_location_code).toBeNull();
  });

  /**
   * Los dos sitios son espacios de nombres independientes (0004): el mismo `code` en las
   * dos plantas son dos filas distintas, y eso es lo que hace que una plantilla de toda la
   * organización resuelva en cada una a lo suyo.
   */
  it('el mismo code puede existir en las dos plantas', async () => {
    const code = uniqueCode('loc-both');

    const a = await locations.createLocation(asCoordinator(), SITE_A, { code, name: `A ${code}` });
    const b = await locations.createLocation(asCoordinator(), SITE_B, { code, name: `B ${code}` });

    expect(a.id).not.toBe(b.id);
    expect(a.site_id).toBe(SITE_A);
    expect(b.site_id).toBe(SITE_B);
  });

  it('rechaza un code repetido dentro de la misma planta, y lo dice', async () => {
    const code = uniqueCode('loc-dup');
    await locations.createLocation(asCoordinator(), SITE_A, { code, name: `One ${code}` });

    await expect(
      locations.createLocation(asCoordinator(), SITE_A, { code, name: `Two ${code}` }),
    ).rejects.toThrow(/code/);
  });

  /**
   * Dos únicos distintos y dos mensajes distintos: `location_site_code_uq` y el parcial
   * `location_site_active_name_uq`. Un «ya existe» a secas dejaría al coordinador
   * cambiando el campo equivocado.
   */
  it('rechaza un nombre repetido entre las activas, y lo dice', async () => {
    const name = `Duplicated name ${uniqueCode('n')}`;
    await locations.createLocation(asCoordinator(), SITE_A, { code: uniqueCode('n1'), name });

    await expect(
      locations.createLocation(asCoordinator(), SITE_A, { code: uniqueCode('n2'), name }),
    ).rejects.toThrow(/named/);
  });

  /**
   * EL AISLAMIENTO CONTESTA ANTES QUE LA FK. Una planta fuera del alcance no la rechaza
   * ningún `if` del servicio: la rechaza la política RLS sobre `location`. Es exactamente
   * lo que hace que el `siteId` de la ruta sea una selección y no el límite (ADR-004), y
   * solo se puede comprobar contra Postgres de verdad.
   */
  it('el motor rechaza una planta fuera del alcance, no el servicio', async () => {
    await expect(
      locations.createLocation(
        { userId: ACTOR, role: 'hs_coordinator', siteIds: [SITE_A] },
        SITE_B,
        { code: uniqueCode('outside'), name: 'Outside the scope' },
      ),
    ).rejects.toThrow(/not one you can administer/);
  });

  it('y con la planta en el alcance, crear ahí funciona', async () => {
    const created = await locations.createLocation(
      { userId: ACTOR, role: 'hs_coordinator', siteIds: [SITE_B] },
      SITE_B,
      { code: uniqueCode('inside'), name: `Inside ${uniqueCode('i')}` },
    );

    expect(created.site_id).toBe(SITE_B);
  });

  it('se lo niega a todo rol que no sea el coordinador', async () => {
    for (const role of ['supervisor', 'jhsc_member', 'management', 'external_auditor']) {
      const other = { userId: ACTOR, role, siteIds: [SITE_A] };

      await expect(
        locations.createOrganizationLocation(other, { code: uniqueCode('x'), name: 'X' }),
      ).rejects.toThrow(/coordinator/);
      await expect(
        locations.createLocation(other, SITE_A, { code: uniqueCode('y'), name: 'Y' }),
      ).rejects.toThrow(/coordinator/);
    }
  });
});

describe('retirar una ubicación compartida desde la consola', () => {
  const asCoordinator = (siteIds: string[] = [SITE_A, SITE_B]) => ({
    userId: ACTOR,
    role: 'hs_coordinator',
    siteIds,
  });

  it('retira la compartida y las físicas de las dos plantas', async () => {
    const shared = await locations.createOrganizationLocation(asCoordinator(), {
      code: uniqueCode('retire-shared'),
      name: 'Retire from both plants',
    });
    const physicalA = await locations.createLocation(asCoordinator(), SITE_A, {
      code: uniqueCode('retire-a'),
      name: 'Retire physical A',
    });
    const physicalB = await locations.createLocation(asCoordinator(), SITE_B, {
      code: uniqueCode('retire-b'),
      name: 'Retire physical B',
    });

    await locations.mapLocation(asCoordinator(), physicalA.id, shared.id);
    await locations.mapLocation(asCoordinator(), physicalB.id, shared.id);
    await locations.deactivateOrganizationLocation(asCoordinator(), shared.id);

    const sharedRows = await inScope<{ deactivated_at: Date | null }>(
      db.migrator,
      [],
      'SELECT deactivated_at FROM organization_location WHERE id = $1',
      [shared.id],
    );
    const physicalRows = await inScope<{ id: string; deactivated_at: Date | null }>(
      db.migrator,
      [SITE_A, SITE_B],
      'SELECT id, deactivated_at FROM location WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[physicalA.id, physicalB.id]],
    );

    expect(one(sharedRows).deactivated_at).not.toBeNull();
    expect(physicalRows).toHaveLength(2);
    expect(physicalRows.every((row) => row.deactivated_at !== null)).toBe(true);
    expect((await locations.listOrganizationLocations(asCoordinator())).map((row) => row.id)).not.toContain(
      shared.id,
    );
    expect((await locations.listLocations(asCoordinator())).map((row) => row.id)).not.toEqual(
      expect.arrayContaining([physicalA.id, physicalB.id]),
    );
  });

  it('rechaza al supervisor y deja activa la compartida', async () => {
    const shared = await locations.createOrganizationLocation(asCoordinator(), {
      code: uniqueCode('supervisor-retire'),
      name: 'Supervisor cannot retire',
    });

    await expect(
      locations.deactivateOrganizationLocation(
        { userId: ACTOR, role: 'supervisor', siteIds: [SITE_A] },
        shared.id,
      ),
    ).rejects.toThrow(/coordinator/);

    const rows = await inScope<{ deactivated_at: Date | null }>(
      db.migrator,
      [],
      'SELECT deactivated_at FROM organization_location WHERE id = $1',
      [shared.id],
    );
    expect(one(rows).deactivated_at).toBeNull();
  });

  it('devuelve 404 al retirar una compartida ya retirada', async () => {
    const shared = await locations.createOrganizationLocation(asCoordinator(), {
      code: uniqueCode('already-retired'),
      name: 'Already retired',
    });

    await locations.deactivateOrganizationLocation(asCoordinator(), shared.id);

    await expect(
      locations.deactivateOrganizationLocation(asCoordinator(), shared.id),
    ).rejects.toThrow(/not found/);
  });
});
