import { RESPONSE_TYPES, type TemplateDocument } from '@hs/contracts';
import { ENGINE_CASES, runEngineCase } from '@hs/forms/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applySeeds } from '../scripts/seed.mjs';

import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, itemRow, publishVersion, registerItems } from './helpers/templates';

/**
 * El motor de formularios visto desde el servidor.
 *
 * Dos cosas distintas se prueban acá:
 *
 * 1. **El mismo veredicto.** La tabla de `@hs/forms/testing` es la misma que
 *    corren los tests del paquete. Si el motor diera otro resultado corriendo en
 *    el servidor, este archivo falla. Es la garantía de ADR-007 hecha CI: el
 *    inspector recorre 48 acres, firma y sincroniza, y el servidor no lo puede
 *    rechazar por una razón que el dispositivo no vio.
 *
 * 2. **Lo que el motor no puede probar solo**: que un documento con los tipos
 *    nuevos se proyecte a filas, que el `CHECK` siga rechazando un tipo
 *    inventado, y que la migración 0007 no haya tocado nada ya publicado.
 */

const CHECK_VIOLATION = '23514';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe('la tabla de casos da el mismo veredicto en el servidor', () => {
  it.each(ENGINE_CASES.map((engineCase) => [engineCase.name, engineCase] as const))(
    '%s',
    (_name, engineCase) => {
      expect(runEngineCase(engineCase)).toEqual([]);
    },
  );

  it('la tabla no está vacía', () => {
    // Un import mal resuelto devolvería un array vacío y los `it.each` de arriba
    // pasarían sin ejercitar nada.
    expect(ENGINE_CASES.length).toBeGreaterThan(20);
  });
});

describe('el modelo publicado acepta los nueve tipos', () => {
  /** Un documento con los tipos que 0007 agregó, más su configuración. */
  function documentWithNewTypes(): TemplateDocument {
    return {
      sections: [
        {
          section_key: 'closeout',
          section_title: 'Close-out',
          position: 1,
          items: [
            {
              item_key: 'ppe.worn',
              prompt: 'PPE worn',
              position: 1,
              required: true,
              response_type: 'multi_choice',
              options: [
                { value: 'gloves', label: 'Gloves' },
                { value: 'goggles', label: 'Goggles' },
              ],
              min_selected: 1,
              max_selected: 2,
            },
            {
              item_key: 'evidence.photos',
              prompt: 'Photos',
              position: 2,
              required: false,
              response_type: 'photo',
              min_count: 0,
              max_count: 3,
              visible_when: { item_key: 'ppe.worn', operator: 'answered' },
            },
            {
              item_key: 'closeout.signature',
              prompt: 'Inspector signature',
              position: 3,
              required: true,
              response_type: 'signature',
            },
          ],
        },
      ],
    };
  }

  /**
   * Una sola publicación para todo el bloque: `item_key` es la PK de
   * `template_item`, así que registrar los mismos conceptos dos veces choca — y
   * con razón, un concepto es único en el sistema entero.
   */
  let versionId: string;

  beforeAll(async () => {
    const templateId = await createTemplate(db.migrator, 'closeout-template');
    await registerItems(db.migrator, templateId, [
      'ppe.worn',
      'evidence.photos',
      'closeout.signature',
    ]);

    versionId = await publishVersion(db.migrator, templateId, 1, documentWithNewTypes());
  });

  it('proyecta un documento con multi_choice, photo y signature', async () => {
    const ppe = await itemRow(db.migrator, versionId, 'ppe.worn');
    const photos = await itemRow(db.migrator, versionId, 'evidence.photos');
    const signature = await itemRow(db.migrator, versionId, 'closeout.signature');

    expect([ppe.response_type, photos.response_type, signature.response_type]).toEqual([
      'multi_choice',
      'photo',
      'signature',
    ]);
  });

  it('proyecta la configuración del ítem a config, y solo la del ítem', async () => {
    const rows = await inScope<{
      item_key: string;
      config: Record<string, unknown> | null;
      visible_when: Record<string, unknown> | null;
    }>(
      db.migrator,
      [],
      `SELECT item_key, config, visible_when
         FROM template_version_item
        WHERE template_version_id = $1
        ORDER BY "position"`,
      [versionId],
    );

    expect(rows.map((row) => row.config)).toEqual([
      {
        options: [
          { value: 'gloves', label: 'Gloves' },
          { value: 'goggles', label: 'Goggles' },
        ],
        min_selected: 1,
        max_selected: 2,
      },
      { min_count: 0, max_count: 3 },
      // `signature` no lleva configuración: NULL, no un objeto vacío.
      null,
    ]);

    expect(rows.map((row) => row.visible_when)).toEqual([
      null,
      { item_key: 'ppe.worn', operator: 'answered' },
      null,
    ]);
  });

  it('sigue rechazando un response_type que no existe', async () => {
    const templateId = await createTemplate(db.migrator, 'bogus-type');
    await registerItems(db.migrator, templateId, ['guards.present']);

    const bogusVersionId = await publishVersion(db.migrator, templateId, 1, {
      sections: [
        {
          section_key: 'general',
          section_title: 'General',
          position: 1,
          items: [
            {
              item_key: 'guards.present',
              prompt: 'Machine guards present?',
              position: 1,
              required: true,
              response_type: 'yes_no',
              fails_on: 'no',
            },
          ],
        },
      ],
    });

    // Directo contra la tabla: el `CHECK` es la última barrera, la que ataja lo
    // que no pasó por el esquema Zod — un INSERT a mano, un seed SQL.
    await expect(
      inScope(
        db.migrator,
        [],
        `INSERT INTO template_version_item (
           template_version_id, item_key, section_key, section_title,
           "position", prompt, response_type, required
         ) VALUES ($1, 'guards.present', 'general', 'General', 99, 'Prompt', 'rating_stars', true)`,
        [bogusVersionId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === CHECK_VIOLATION);
  });

  it('el CHECK del SQL y RESPONSE_TYPES no pueden divergir', async () => {
    const rows = await inScope<{ definition: string }>(
      db.migrator,
      [],
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'template_version_item_response_type_check'`,
    );

    const definition = one(rows).definition;

    // La lista está escrita dos veces —en el SQL y en `packages/forms`— porque
    // SQL no puede importar TypeScript. Que estén las dos es deliberado; que
    // digan cosas distintas, no.
    for (const responseType of RESPONSE_TYPES) {
      expect(definition, responseType).toContain(`'${responseType}'`);
    }

    const quoted = definition.match(/'[a-z_]+'::text/g) ?? [];

    expect(quoted.length).toBe(RESPONSE_TYPES.length);
  });
});

describe('0007 no tocó nada publicado', () => {
  it('el seed conserva su documento y sus response_type', async () => {
    await applySeeds(db.migrator);

    // Solo la plantilla del seed: los describes de arriba publicaron sus propias
    // versiones en esta misma base y no tienen nada que ver con lo preexistente.
    const versions = await inScope<{ document: TemplateDocument }>(
      db.migrator,
      [],
      `SELECT tv.document
         FROM template_version tv
         JOIN template t ON t.id = tv.template_id
        WHERE t.key = 'monthly-general-inspection'
        ORDER BY tv.version`,
    );

    expect(versions.length).toBeGreaterThan(0);

    // El seed es de los cuatro tipos originales: si la migración hubiera
    // reescrito filas, acá aparecerían tipos o campos que el seed no declara.
    const seededTypes = new Set(
      versions.flatMap((version) =>
        version.document.sections.flatMap((section) =>
          section.items.map((item) => item.response_type),
        ),
      ),
    );

    expect([...seededTypes]).toEqual(['yes_no']);

    const rows = await inScope<{ response_type: string; config: unknown; visible_when: unknown }>(
      db.migrator,
      [],
      `SELECT tvi.response_type, tvi.config, tvi.visible_when
         FROM template_version_item tvi
         JOIN template_version tv ON tv.id = tvi.template_version_id
         JOIN template t ON t.id = tv.template_id
        WHERE t.key = 'monthly-general-inspection'`,
    );

    expect(rows.every((row) => row.response_type === 'yes_no')).toBe(true);

    // Las columnas nuevas nacen nulas para lo ya publicado: re-proyectar sería
    // escribir sobre una tabla inmutable (ADR-002).
    expect(rows.every((row) => row.config === null && row.visible_when === null)).toBe(true);
  });
});
