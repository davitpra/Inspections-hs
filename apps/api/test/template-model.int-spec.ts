import { templateDocumentSchema, type TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applySeeds } from '../scripts/seed.mjs';
import {
  createTemplate,
  itemRow,
  publishVersion,
  registerItems,
} from './helpers/templates';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';

const INSUFFICIENT_PRIVILEGE = '42501';
const APPEND_ONLY = 'HS001';
const NOT_NEXT_VERSION = 'HS002';
const CANNOT_PROJECT = 'HS003';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

/**
 * Documento de N ítems repartidos en dos secciones. Con un solo ítem queda una
 * sola sección: el trigger rechaza una sección vacía, y con razón — una sección
 * sin ítems es un documento a medio escribir.
 */
function documentWith(itemKeys: readonly string[]): TemplateDocument {
  const half = Math.ceil(itemKeys.length / 2);

  const sections: TemplateDocument['sections'] = [
    {
      section_key: 'general',
      section_title: 'General',
      position: 1,
      items: itemKeys.slice(0, half).map((item_key, index) => ({
        item_key,
        prompt: `Prompt for ${item_key}`,
        position: index + 1,
        response_type: 'yes_no' as const,
        required: true,
      })),
    },
  ];

  const rest = itemKeys.slice(half);

  if (rest.length > 0) {
    sections.push({
      section_key: 'machine-safety',
      section_title: 'Machine safety',
      position: 2,
      items: rest.map((item_key, index) => ({
        item_key,
        prompt: `Prompt for ${item_key}`,
        position: index + 1,
        response_type: 'scale' as const,
        min: 1,
        max: 5,
        required: false,
      })),
    });
  }

  return { sections };
}

describe('la versión publicada es inmutable', () => {
  let versionId: string;
  let rowId: string;

  beforeAll(async () => {
    const templateId = await createTemplate(db.migrator, 'frozen');
    await registerItems(db.migrator, templateId, ['frozen.one', 'frozen.two']);
    versionId = await publishVersion(
      db.migrator,
      templateId,
      1,
      documentWith(['frozen.one', 'frozen.two']),
    );
    rowId = (await itemRow(db.migrator, versionId, 'frozen.one')).id;
  });

  it('rechaza UPDATE de hs_app sobre el documento con 42501', async () => {
    await expect(
      inScope(db.app, [], `UPDATE template_version SET document = '{}'::jsonb WHERE id = $1`, [
        versionId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const row = one(
      await inScope<{ document: TemplateDocument }>(
        db.app,
        [],
        'SELECT document FROM template_version WHERE id = $1',
        [versionId],
      ),
    );

    expect(row.document.sections).toHaveLength(2);
  });

  // hs_migrator es dueño de la tabla, así que el REVOKE no lo alcanza: es el
  // único rol con el que se puede probar la segunda barrera.
  it('rechaza UPDATE de hs_migrator con el SQLSTATE del trigger, no con el de privilegio', async () => {
    let caught: unknown;

    try {
      await inScope(
        db.migrator,
        [],
        `UPDATE template_version SET document = '{}'::jsonb WHERE id = $1`,
        [versionId],
      );
    } catch (error) {
      caught = error;
    }

    expect(sqlstate(caught)).toBe(APPEND_ONLY);
    expect((caught as Error).message).toContain('template_version');
    expect((caught as Error).message).toContain('append-only');
  });

  it('rechaza UPDATE y DELETE de hs_app sobre las filas de ítem', async () => {
    await expect(
      inScope(db.app, [], `UPDATE template_version_item SET prompt = 'edited' WHERE id = $1`, [
        rowId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    await expect(
      inScope(db.app, [], 'DELETE FROM template_version_item WHERE id = $1', [rowId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const rows = await inScope(db.app, [], 'SELECT id FROM template_version_item WHERE id = $1', [
      rowId,
    ]);

    expect(rows).toHaveLength(1);
  });

  /**
   * La etapa 8 concedió el INSERT que `0003` §9 dejó anunciado (`0025` §1), así que el
   * builder publica con el mismo rol con el que la API lee. Lo que NO cambió es lo único
   * que este bloque custodia: lo que `hs_app` acaba de insertar es tan inalterable como lo
   * que escribió un seed. El GRANT es sobre INSERT y sobre nada más.
   */
  it('hs_app publica, y lo publicado le queda tan congelado como lo del seed', async () => {
    const published = one(
      await inScope<{ id: string }>(
        db.app,
        [],
        `INSERT INTO template (key, name) VALUES ('builder-frozen', 'Builder frozen')
         RETURNING id`,
      ),
    );

    await inScope(db.app, [], 'INSERT INTO template_item (item_key, template_id) VALUES ($1, $2)', [
      'builder.frozen',
      published.id,
    ]);

    const version = one(
      await inScope<{ id: string }>(
        db.app,
        [],
        `INSERT INTO template_version (template_id, version, document)
              VALUES ($1, 1, $2::jsonb)
           RETURNING id`,
        [published.id, JSON.stringify(documentWith(['builder.frozen']))],
      ),
    );

    // El trigger de proyección corre como `hs_app`, que es por lo que el GRANT de `0025`
    // §1 también alcanza a `template_version_item`.
    const projected = await inScope(
      db.app,
      [],
      'SELECT id FROM template_version_item WHERE template_version_id = $1',
      [version.id],
    );

    expect(projected).toHaveLength(1);

    await expect(
      inScope(db.app, [], `UPDATE template_version SET document = '{}'::jsonb WHERE id = $1`, [
        version.id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    await expect(
      inScope(db.app, [], 'DELETE FROM template_version WHERE id = $1', [version.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    // La plantilla publicada conserva su contenido, pero desde 0033 se puede retirar
    // fijando `deactivated_at`. Lo que sigue prohibido es borrarla.
    await inScope(db.app, [], 'UPDATE template SET deactivated_at = now() WHERE id = $1', [
      published.id,
    ]);

    const retired = await inScope<{ deactivated_at: Date | null }>(
      db.migrator,
      [],
      'SELECT deactivated_at FROM template WHERE id = $1',
      [published.id],
    );
    expect(retired[0]?.deactivated_at).not.toBeNull();

    await expect(
      inScope(db.app, [], 'DELETE FROM template WHERE id = $1', [published.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });
});

describe('proyección del documento a filas', () => {
  it('deriva una fila por ítem del documento', async () => {
    const itemKeys = ['proj.a', 'proj.b', 'proj.c', 'proj.d', 'proj.e', 'proj.f', 'proj.g'];
    const templateId = await createTemplate(db.migrator, 'projection');
    await registerItems(db.migrator, templateId, itemKeys);
    const versionId = await publishVersion(db.migrator, templateId, 1, documentWith(itemKeys));

    // Contra el documento, no contra un número escrito a mano: si el documento
    // cambia y el trigger no, la comparación tiene que romperse.
    const counted = one(
      await inScope<{ declared: number; derived: number }>(
        db.migrator,
        [],
        `SELECT (
           SELECT sum(jsonb_array_length(section -> 'items'))::int
             FROM template_version v, jsonb_array_elements(v.document -> 'sections') AS section
            WHERE v.id = $1
         ) AS declared,
         (SELECT count(*)::int FROM template_version_item WHERE template_version_id = $1) AS derived`,
        [versionId],
      ),
    );

    expect(counted.derived).toBe(counted.declared);
    expect(counted.derived).toBe(itemKeys.length);
  });

  it('cada fila lleva los campos que declaró el documento', async () => {
    const templateId = await createTemplate(db.migrator, 'projection-fields');
    await registerItems(db.migrator, templateId, ['fields.one', 'fields.two']);
    const document = documentWith(['fields.one', 'fields.two']);
    const versionId = await publishVersion(db.migrator, templateId, 1, document);

    const row = await itemRow(db.migrator, versionId, 'fields.two');

    expect(row).toMatchObject({
      section_key: 'machine-safety',
      section_title: 'Machine safety',
      position: 1,
      prompt: 'Prompt for fields.two',
      response_type: 'scale',
      required: false,
    });
  });

  it('rechaza un documento sin secciones en lugar de derivar cero filas', async () => {
    const templateId = await createTemplate(db.migrator, 'empty-document');

    await expect(
      inScope(
        db.migrator,
        [],
        `INSERT INTO template_version (template_id, version, document)
         VALUES ($1, 1, '{"sections": []}'::jsonb)`,
        [templateId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === CANNOT_PROJECT);
  });
});

describe('item_key: inmutable, única, y siempre resuelta', () => {
  let templateId: string;

  beforeAll(async () => {
    templateId = await createTemplate(db.migrator, 'keys');
    await registerItems(db.migrator, templateId, ['keys.original']);
  });

  it('rechaza cambiar la item_key con HS001', async () => {
    let caught: unknown;

    try {
      await inScope(
        db.migrator,
        [],
        `UPDATE template_item SET item_key = 'keys.renamed' WHERE item_key = 'keys.original'`,
      );
    } catch (error) {
      caught = error;
    }

    expect(sqlstate(caught)).toBe(APPEND_ONLY);

    const rows = await inScope(
      db.migrator,
      [],
      `SELECT item_key FROM template_item WHERE item_key = 'keys.original'`,
    );

    expect(rows).toHaveLength(1);
  });

  it('acepta el UPDATE de deactivated_at, que es la única mutación permitida', async () => {
    const templateOther = await createTemplate(db.migrator, 'keys-deactivation');
    await registerItems(db.migrator, templateOther, ['keys.retired']);

    await inScope(
      db.migrator,
      [],
      `UPDATE template_item SET deactivated_at = now() WHERE item_key = 'keys.retired'`,
    );

    const row = one(
      await inScope<{ deactivated_at: Date | null }>(
        db.migrator,
        [],
        `SELECT deactivated_at FROM template_item WHERE item_key = 'keys.retired'`,
      ),
    );

    expect(row.deactivated_at).not.toBeNull();
  });

  it('rechaza reusar una item_key para un concepto distinto', async () => {
    await expect(registerItems(db.migrator, templateId, ['keys.original'])).rejects.toSatisfy(
      (error) => sqlstate(error) === UNIQUE_VIOLATION,
    );
  });

  it('rechaza una fila de ítem cuya item_key no está registrada', async () => {
    const orphan = await createTemplate(db.migrator, 'orphan-key');

    await expect(
      publishVersion(db.migrator, orphan, 1, documentWith(['orphan.unregistered'])),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });

  it('rechaza un replaces_item_key inexistente', async () => {
    await expect(
      registerItems(db.migrator, templateId, ['keys.split'], {
        replacesItemKey: 'keys.nonexistent',
      }),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });

  it('rechaza borrar un concepto: se desactiva, no se borra', async () => {
    await expect(
      inScope(db.migrator, [], `DELETE FROM template_item WHERE item_key = 'keys.original'`),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);
  });
});

describe('desactivación', () => {
  it('un ítem desactivado no entra en una versión nueva pero sigue resolviendo en las viejas', async () => {
    const templateId = await createTemplate(db.migrator, 'deactivation');
    await registerItems(db.migrator, templateId, ['deact.one', 'deact.two']);
    const v1 = await publishVersion(
      db.migrator,
      templateId,
      1,
      documentWith(['deact.one', 'deact.two']),
    );

    await inScope(
      db.migrator,
      [],
      `UPDATE template_item SET deactivated_at = now() WHERE item_key = 'deact.two'`,
    );

    let caught: unknown;

    try {
      await publishVersion(db.migrator, templateId, 2, documentWith(['deact.one', 'deact.two']));
    } catch (error) {
      caught = error;
    }

    expect(sqlstate(caught)).toBe(CANNOT_PROJECT);
    expect((caught as Error).message).toContain('deact.two');

    // La versión ya publicada sigue resolviendo el ítem: su serie termina, no se
    // rompe.
    const row = await itemRow(db.migrator, v1, 'deact.two');
    expect(row.item_key).toBe('deact.two');
  });
});

describe('numeración de versiones', () => {
  it('rechaza una versión salteada', async () => {
    const templateId = await createTemplate(db.migrator, 'numbering');
    await registerItems(db.migrator, templateId, ['num.one']);
    await publishVersion(db.migrator, templateId, 1, documentWith(['num.one']));
    await publishVersion(db.migrator, templateId, 2, documentWith(['num.one']));

    let caught: unknown;

    try {
      await publishVersion(db.migrator, templateId, 4, documentWith(['num.one']));
    } catch (error) {
      caught = error;
    }

    expect(sqlstate(caught)).toBe(NOT_NEXT_VERSION);
    expect((caught as Error).message).toContain('expected 3');
  });

  it('rechaza repetir una versión ya publicada', async () => {
    const templateId = await createTemplate(db.migrator, 'numbering-repeat');
    await registerItems(db.migrator, templateId, ['repeat.one']);
    await publishVersion(db.migrator, templateId, 1, documentWith(['repeat.one']));

    // El trigger de numeración llega primero: la versión 1 ya no es la siguiente.
    await expect(
      publishVersion(db.migrator, templateId, 1, documentWith(['repeat.one'])),
    ).rejects.toSatisfy((error) => sqlstate(error) === NOT_NEXT_VERSION);
  });
});

describe('seeds', () => {
  beforeAll(async () => {
    await applySeeds(db.migrator);
    // Idempotencia: la segunda corrida no puede fallar ni duplicar.
    await applySeeds(db.migrator);
  });

  it('todo documento sembrado parsea contra el esquema de @hs/contracts', async () => {
    const rows = await inScope<{ key: string; version: number; document: unknown }>(
      db.migrator,
      [],
      `SELECT t.key, v.version, v.document
         FROM template_version v JOIN template t ON t.id = v.template_id
        WHERE t.key LIKE 'monthly-%'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const result = templateDocumentSchema.safeParse(row.document);

      if (!result.success) {
        throw new Error(
          `${row.key} v${row.version}: ${result.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });

  it('cada ítem del documento sembrado tiene su fila y su concepto registrado', async () => {
    const row = one(
      await inScope<{ declared: number; derived: number; registered: number }>(
        db.migrator,
        [],
        `WITH seeded AS (
           SELECT v.id, v.document
             FROM template_version v JOIN template t ON t.id = v.template_id
            WHERE t.key = 'monthly-general-inspection' AND v.version = 1
         ),
         declared AS (
           SELECT item ->> 'item_key' AS item_key
             FROM seeded,
                  jsonb_array_elements(seeded.document -> 'sections') AS section,
                  jsonb_array_elements(section -> 'items') AS item
         )
         SELECT (SELECT count(*)::int FROM declared) AS declared,
                (SELECT count(*)::int FROM template_version_item vi, seeded
                  WHERE vi.template_version_id = seeded.id) AS derived,
                (SELECT count(*)::int FROM template_item ti
                  WHERE ti.item_key IN (SELECT item_key FROM declared)) AS registered`,
      ),
    );

    expect(row.derived).toBe(row.declared);
    expect(row.registered).toBe(row.declared);
  });

  it('sembrar dos veces deja una sola copia', async () => {
    const before = one(
      await inScope<{ count: string }>(
        db.migrator,
        [],
        `SELECT count(*)::text AS count FROM template WHERE key = 'monthly-general-inspection'`,
      ),
    );

    await applySeeds(db.migrator);

    const after = one(
      await inScope<{ count: string }>(
        db.migrator,
        [],
        `SELECT count(*)::text AS count FROM template WHERE key = 'monthly-general-inspection'`,
      ),
    );

    expect(before.count).toBe('1');
    expect(after.count).toBe('1');
  });
});
