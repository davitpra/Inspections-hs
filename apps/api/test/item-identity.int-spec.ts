import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocation, registerSite } from './helpers/catalog';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import {
  createTemplate,
  itemRow,
  publishVersion,
  registerItems,
  type VersionItemRow,
} from './helpers/templates';

/**
 * SPIKE 3 — la prueba de aceptación obligatoria del riesgo A
 * (`docs/Requisitos_V1.2.md` §5).
 *
 * Tres versiones sucesivas con ediciones realistas: v1 crea el ítem y genera un
 * hallazgo; v2 lo reescribe, lo mueve de sección y lo reordena, y genera dos;
 * v3 le cambia el tipo de respuesta de sí/no a escala, y genera uno.
 *
 * La aserción: la consulta de recurrencia devuelve **una serie de 4**. Si
 * devuelve 1 + 2 + 1, el esquema está mal y se descubrió antes de tener datos
 * reales.
 *
 * El riesgo A no falla ruidosamente: los IDs existen, los joins funcionan, la
 * consulta devuelve filas. Simplemente agrupa mal, y "agrupa mal" en una
 * detección de patrones se ve idéntico a "no hay patrón". Por eso el test afirma
 * también, explícitamente, que NO devuelve tres series.
 */

const ITEM_KEY = 'guards.packaging-lines';
const SPIKE_SITE = '88888888-8888-4888-8888-888888888888';
const FOREIGN_KEY_VIOLATION = '23503';

let db: TestDatabase;
let templateId: string;

// El hallazgo lleva ubicación desde `0004`. Para el spike da lo mismo cuál sea:
// lo que se prueba acá es la identidad del ítem. Que la ubicación sea del mismo
// sitio lo prueba `catalog.int-spec.ts`.
let siteId: string;
let locationId: string;

const versionIds: string[] = [];

/**
 * El documento de una versión: una sección, un ítem.
 *
 * El ítem entero viaja como parámetro y no campo por campo: desde que el
 * `response_type` es una unión discriminada, cada tipo trae su propia
 * configuración y no hay una firma común que los cubra a todos.
 */
function documentFor(
  section: { section_key: string; section_title: string },
  item: TemplateDocument['sections'][number]['items'][number],
): TemplateDocument {
  return {
    sections: [
      {
        section_key: section.section_key,
        section_title: section.section_title,
        position: 1,
        items: [item],
      },
    ],
  };
}

/** Registra N hallazgos contra la fila de ítem de una versión concreta. */
async function recordFindings(row: VersionItemRow, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await inScope(
      db.migrator,
      [],
      `INSERT INTO finding_stub (template_version_item_id, item_key, site_id, location_id)
       VALUES ($1, $2, $3, $4)`,
      [row.id, row.item_key, siteId, locationId],
    );
  }
}

/**
 * La consulta de recurrencia, en su forma mínima: agrupar por `item_key`.
 *
 * Es deliberadamente la más simple posible. La de la etapa 7 agrega
 * `location_id`, ventana temporal y umbral; lo que se prueba acá es la única
 * parte de la que dependen todas las variantes — que la clave de agrupación
 * sobreviva a las ediciones de plantilla.
 */
async function recurrenceSeries(): Promise<{ item_key: string; findings: number }[]> {
  return inScope<{ item_key: string; findings: number }>(
    db.migrator,
    [],
    `SELECT item_key, count(*)::int AS findings
       FROM finding_stub
      WHERE item_key IS NOT NULL
      GROUP BY item_key
      ORDER BY item_key`,
  );
}

beforeAll(async () => {
  db = await startTestDatabase();

  const fixture = resolve(dirname(__filename), 'fixtures/finding_stub.sql');
  await db.migrator.query(await readFile(fixture, 'utf8'));

  siteId = await registerSite(db.migrator, SPIKE_SITE, 'spike-site');
  locationId = await createLocation(db.migrator, siteId, 'packaging-line-3', 'Packaging line 3');

  templateId = await createTemplate(db.migrator, 'monthly-inspection-spike');
  await registerItems(db.migrator, templateId, [ITEM_KEY]);

  // v1 — el ítem se crea. Un hallazgo.
  versionIds[0] = await publishVersion(
    db.migrator,
    templateId,
    1,
    documentFor(
      { section_key: 'general', section_title: 'General' },
      {
        item_key: ITEM_KEY,
        prompt: 'Machine guards present?',
        position: 4,
        response_type: 'yes_no',
        required: true,
      },
    ),
  );
  await recordFindings(await itemRow(db.migrator, versionIds[0], ITEM_KEY), 1);

  // v2 — reescrito, movido de sección y reordenado. Misma item_key. Dos hallazgos.
  versionIds[1] = await publishVersion(
    db.migrator,
    templateId,
    2,
    documentFor(
      { section_key: 'machine-safety', section_title: 'Machine safety' },
      {
        item_key: ITEM_KEY,
        prompt: 'Are machine guards in place and secured on all packaging lines?',
        position: 1,
        response_type: 'yes_no',
        required: true,
      },
    ),
  );
  await recordFindings(await itemRow(db.migrator, versionIds[1], ITEM_KEY), 2);

  // v3 — cambia el tipo de respuesta de sí/no a escala. Misma item_key. Un hallazgo.
  versionIds[2] = await publishVersion(
    db.migrator,
    templateId,
    3,
    documentFor(
      { section_key: 'machine-safety', section_title: 'Machine safety' },
      {
        item_key: ITEM_KEY,
        prompt: 'Are machine guards in place and secured on all packaging lines?',
        position: 1,
        response_type: 'scale',
        min: 1,
        max: 5,
        required: true,
      },
    ),
  );
  await recordFindings(await itemRow(db.migrator, versionIds[2], ITEM_KEY), 1);
});

afterAll(async () => {
  await db?.stop();
});

describe('la item_key sobrevive a toda edición', () => {
  it('reescribir el texto conserva la key', async () => {
    const v1 = await itemRow(db.migrator, versionIds[0]!, ITEM_KEY);
    const v2 = await itemRow(db.migrator, versionIds[1]!, ITEM_KEY);

    expect(v1.prompt).toBe('Machine guards present?');
    expect(v2.prompt).toBe('Are machine guards in place and secured on all packaging lines?');
    expect(v2.item_key).toBe(v1.item_key);
  });

  it('mover el ítem de sección conserva la key', async () => {
    const v1 = await itemRow(db.migrator, versionIds[0]!, ITEM_KEY);
    const v2 = await itemRow(db.migrator, versionIds[1]!, ITEM_KEY);

    expect(v1.section_key).toBe('general');
    expect(v2.section_key).toBe('machine-safety');
    expect(v2.item_key).toBe(v1.item_key);
  });

  it('reordenarlo conserva la key', async () => {
    const v1 = await itemRow(db.migrator, versionIds[0]!, ITEM_KEY);
    const v2 = await itemRow(db.migrator, versionIds[1]!, ITEM_KEY);

    expect(v1.position).toBe(4);
    expect(v2.position).toBe(1);
    expect(v2.item_key).toBe(v1.item_key);
  });

  it('cambiarle el tipo de respuesta conserva la key', async () => {
    const v2 = await itemRow(db.migrator, versionIds[1]!, ITEM_KEY);
    const v3 = await itemRow(db.migrator, versionIds[2]!, ITEM_KEY);

    expect(v2.response_type).toBe('yes_no');
    expect(v3.response_type).toBe('scale');
    expect(v3.item_key).toBe(v2.item_key);
  });

  it('las tres versiones tienen tres filas distintas para el mismo concepto', async () => {
    const rows = await Promise.all(
      versionIds.map((versionId) => itemRow(db.migrator, versionId, ITEM_KEY)),
    );

    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(new Set(rows.map((row) => row.item_key)).size).toBe(1);
  });
});

describe('spike 3: la consulta de recurrencia devuelve una serie de 4', () => {
  it('una sola serie, con los cuatro hallazgos', async () => {
    const series = await recurrenceSeries();

    expect(series).toEqual([{ item_key: ITEM_KEY, findings: 4 }]);
  });

  // La aserción explícita del modo de fallo: 1 + 2 + 1 es exactamente lo que
  // devolvería un esquema que agrupa por la fila de la versión.
  it('no devuelve tres series de 1, 2 y 1', async () => {
    const series = await recurrenceSeries();

    expect(series).toHaveLength(1);
    expect(series.map((row) => row.findings)).not.toEqual([1, 2, 1]);
  });

  it('agrupar por la fila de la versión es justo lo que partiría la serie', async () => {
    // No es una regresión: es la demostración de por qué la identidad es dual.
    // Si el hallazgo apuntara solo a la fila, esto sería la serie histórica.
    const byRow = await inScope<{ findings: number }>(
      db.migrator,
      [],
      `SELECT count(*)::int AS findings
         FROM finding_stub
        GROUP BY template_version_item_id
        ORDER BY count(*)`,
    );

    expect(byRow.map((row) => row.findings)).toEqual([1, 1, 2]);
  });
});

describe('fidelidad legal: cada hallazgo resuelve la pregunta que se hizo', () => {
  it('el hallazgo de v1 resuelve la redacción, la sección y el orden de v1', async () => {
    const row = one(
      await inScope<VersionItemRow>(
        db.migrator,
        [],
        `SELECT vi.prompt, vi.section_key, vi."position", vi.response_type
           FROM finding_stub f
           JOIN template_version_item vi ON vi.id = f.template_version_item_id
          WHERE vi.template_version_id = $1`,
        [versionIds[0]],
      ),
    );

    expect(row).toMatchObject({
      prompt: 'Machine guards present?',
      section_key: 'general',
      position: 4,
      response_type: 'yes_no',
    });
  });

  it('el hallazgo de v3 resuelve response_type escala', async () => {
    const row = one(
      await inScope<VersionItemRow>(
        db.migrator,
        [],
        `SELECT vi.response_type
           FROM finding_stub f
           JOIN template_version_item vi ON vi.id = f.template_version_item_id
          WHERE vi.template_version_id = $1`,
        [versionIds[2]],
      ),
    );

    expect(row.response_type).toBe('scale');
  });
});

describe('linaje y punto ciego', () => {
  it('un ítem que reemplaza a otro arranca su propia serie, no hereda la anterior', async () => {
    await registerItems(db.migrator, templateId, ['guards.line-3'], {
      replacesItemKey: ITEM_KEY,
    });

    const version = await publishVersion(
      db.migrator,
      templateId,
      4,
      {
        sections: [
          {
            section_key: 'machine-safety',
            section_title: 'Machine safety',
            position: 1,
            items: [
              {
                item_key: 'guards.line-3',
                prompt: 'Are machine guards in place on packaging line 3?',
                position: 1,
                response_type: 'yes_no',
                required: true,
              },
            ],
          },
        ],
      },
    );

    await recordFindings(await itemRow(db.migrator, version, 'guards.line-3'), 1);

    const series = await recurrenceSeries();

    // Dos series separadas: el linaje es rastro, no regla de agrupación.
    expect(series).toEqual([
      { item_key: 'guards.line-3', findings: 1 },
      { item_key: ITEM_KEY, findings: 4 },
    ]);

    const lineage = one(
      await inScope<{ replaces_item_key: string | null }>(
        db.migrator,
        [],
        `SELECT replaces_item_key FROM template_item WHERE item_key = 'guards.line-3'`,
      ),
    );

    expect(lineage.replaces_item_key).toBe(ITEM_KEY);
  });

  // Consecuencia aceptada de §4: el hallazgo manual no tiene item_key y queda
  // fuera de la recurrencia. Se ejerce en lugar de ignorarse.
  it('un hallazgo manual no entra en ninguna serie', async () => {
    const row = await itemRow(db.migrator, versionIds[2]!, ITEM_KEY);

    await inScope(
      db.migrator,
      [],
      `INSERT INTO finding_stub (template_version_item_id, item_key, site_id, location_id)
       VALUES ($1, NULL, $2, $3)`,
      [row.id, siteId, locationId],
    );

    const series = await recurrenceSeries();

    expect(series.find((entry) => entry.item_key === ITEM_KEY)?.findings).toBe(4);
  });

  it('un hallazgo no puede apuntar a una item_key que no existe', async () => {
    const row = await itemRow(db.migrator, versionIds[2]!, ITEM_KEY);

    await expect(
      inScope(
        db.migrator,
        [],
        `INSERT INTO finding_stub (template_version_item_id, item_key, site_id, location_id)
         VALUES ($1, $2, $3, $4)`,
        [row.id, 'guards.invented', siteId, locationId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });
});
