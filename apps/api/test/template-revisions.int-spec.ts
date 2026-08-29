import type { TemplateDraftDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbService } from '../src/db/db.service';
import { TemplatesService } from '../src/templates/templates.service';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { createTemplate, registerItems } from './helpers/templates';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * Revisar una plantilla publicada: la versión N+1 (etapa 8, tercera mitad).
 *
 * LO QUE JUSTIFICA QUE ESTO SEA INTEGRACIÓN Y NO UNITARIO:
 *
 *   - **El número de versión lo decide el motor.** `insertVersion` propone `max + 1` y
 *     `hs_template_version_next()` (0003 §5) lo recalcula bajo un advisory lock y levanta
 *     `HS002` si no coincide. Que las dos cuentas den lo mismo solo lo dice Postgres.
 *   - **`template_version_item` lo deriva un trigger**, no el servicio. Que el `item_key`
 *     sobreviva a la versión nueva con un `id` de fila distinto —la identidad dual entera— se
 *     comprueba leyendo lo que el trigger escribió.
 *   - **Una sola revisión viva por plantilla la garantiza un índice parcial** (0028 §2), no un
 *     `if`. El servicio devuelve la que hay; el índice es el que hace que no pueda haber dos.
 *   - **Publicar una revisión no toca ni una fila publicada**, y `hs_app` sigue sin `UPDATE`
 *     sobre `template` ni sobre `template_item`. Corregir es escribir, nunca reescribir.
 */

const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const SITE = 'd7000000-0000-4000-8000-000000000001';

let db: TestDatabase;
let dbService: DbService;
let templates: TemplatesService;

let coordinatorId: string;
let supervisorId: string;

const asCoordinator = () => ({ userId: coordinatorId, role: 'hs_coordinator', siteIds: [SITE] });
const asSupervisor = () => ({ userId: supervisorId, role: 'supervisor', siteIds: [SITE] });

/** Una sección con un ítem: el borrador publicable más chico que existe. */
function usableDocument(
  itemKey = 'guard.fitted',
  prompt = 'Is the guard fitted?',
): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Guarding',
        items: [
          { item_key: itemKey, prompt, required: true, response_type: 'yes_no', fails_on: 'no' },
        ],
      },
    ],
  };
}

let published = 0;

/**
 * Una plantilla publicada de verdad, por el mismo camino que usa el coordinador.
 *
 * No se siembra con `createTemplate` del helper: lo que se está probando es la segunda
 * publicación, y la primera tiene que haber dejado el estado que la segunda va a encontrar.
 */
async function publishedTemplate(itemKey = 'guard.fitted') {
  published += 1;

  const draft = await templates.createDraft(asCoordinator(), {
    name: `Revisable inspection ${published}`,
  });

  await templates.saveDraft(asCoordinator(), draft.id, {
    name: draft.name,
    document: usableDocument(itemKey),
    site_ids: [SITE],
  });

  return { draft, version: await templates.publishDraft(asCoordinator(), draft.id) };
}

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  templates = new TemplatesService(dbService);

  await registerSite(db.migrator, SITE, 'revisions', 'Revisions');

  coordinatorId = (await createAccount(db.app, { siteIds: [SITE], role: 'hs_coordinator' }))
    .accountId;
  supervisorId = (await createAccount(db.app, { siteIds: [SITE], role: 'supervisor' })).accountId;
}, 120_000);

afterAll(async () => {
  await dbService?.onModuleDestroy();
  await db?.stop();
});

describe('sembrar el borrador', () => {
  it('copia el documento publicado con su item_key y hereda clave y nombre', async () => {
    const { draft, version } = await publishedTemplate();

    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    expect(revision.template_id).toBe(version.template_id);
    expect(revision.key).toBe(draft.key);
    expect(revision.name).toBe(draft.name);
    expect(revision.document).toEqual(usableDocument());
    expect(revision.next_version).toBe(2);
    expect(revision.publishable).toBe(true);
  });

  it('no escribe una sola fila en el modelo publicado', async () => {
    const { version } = await publishedTemplate('seeding.untouched');

    const before = await publishedRowCounts();
    await templates.reviseTemplate(asCoordinator(), version.template_id);

    expect(await publishedRowCounts()).toEqual(before);
  });

  it('devuelve la revisión viva en vez de crear una segunda', async () => {
    const { version } = await publishedTemplate('idempotent.revise');

    const first = await templates.reviseTemplate(asCoordinator(), version.template_id);
    const second = await templates.reviseTemplate(asCoordinator(), version.template_id);

    expect(second.id).toBe(first.id);
  });

  it('el motor rechaza una segunda revisión viva, que es lo que hace segura la idempotencia', async () => {
    const { version } = await publishedTemplate('one.revision');
    const live = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await expect(
      inScope(
        db.app,
        [SITE],
        `INSERT INTO template_draft (key, name, document, created_by, site_ids, template_id)
              VALUES ($1, $2, '{"sections":[]}'::jsonb, $3, $4::uuid[], $5)`,
        [`${live.key}-2`, `${live.name} again`, coordinatorId, [SITE], version.template_id],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  it('descartar la revisión deja volver a revisar', async () => {
    const { version } = await publishedTemplate('discard.revise');
    const first = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await templates.discardDraft(asCoordinator(), first.id);

    const second = await templates.reviseTemplate(asCoordinator(), version.template_id);

    expect(second.id).not.toBe(first.id);
  });

  it('es del coordinador', async () => {
    const { version } = await publishedTemplate('role.revise');

    await expect(
      templates.reviseTemplate(asSupervisor(), version.template_id),
    ).rejects.toMatchObject({ response: { code: 'template_draft_forbidden' } });
  });

  it('una plantilla que no existe no se puede revisar', async () => {
    await expect(
      templates.reviseTemplate(asCoordinator(), '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ response: { code: 'template_not_found' } });
  });

  it('una plantilla sin ninguna versión publicada tampoco', async () => {
    const templateId = await createTemplate(db.migrator, 'never-published', 'Never published');

    await expect(templates.reviseTemplate(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_version_not_found' },
    });
  });

  it('no cambia lo que se ofrece para programar hasta que se publique', async () => {
    const { version } = await publishedTemplate('scheduling.unchanged');

    await templates.reviseTemplate(asCoordinator(), version.template_id);

    const offered = (await templates.list(asCoordinator())).find(
      (option) => option.id === version.template_id,
    );

    expect(offered?.latest_version).toBe(1);
  });
});

describe('publicar la revisión', () => {
  it('escribe la versión 2 de la misma plantilla y ninguna plantilla nueva', async () => {
    const { version } = await publishedTemplate('publish.v2');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    const before = one(
      await inScope<{ count: string }>(db.app, [SITE], 'SELECT count(*) FROM template'),
    ).count;

    const second = await templates.publishDraft(asCoordinator(), revision.id);

    expect(second.template_id).toBe(version.template_id);
    expect(second.version).toBe(2);
    expect(second.template_version_id).not.toBe(version.template_version_id);
    expect(
      one(await inScope<{ count: string }>(db.app, [SITE], 'SELECT count(*) FROM template')).count,
    ).toBe(before);
  });

  it('la pregunta reformulada conserva su item_key y estrena su fila', async () => {
    const { version } = await publishedTemplate('reword.keeps.key');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await templates.saveDraft(asCoordinator(), revision.id, {
      name: revision.name,
      document: usableDocument('reword.keeps.key', 'Is the machine guard fitted and secured?'),
      site_ids: [SITE],
    });

    const second = await templates.publishDraft(asCoordinator(), revision.id);

    const rows = await inScope<{ id: string; prompt: string; template_version_id: string }>(
      db.app,
      [SITE],
      `SELECT id, prompt, template_version_id
         FROM template_version_item
        WHERE item_key = $1
        ORDER BY template_version_id`,
      ['reword.keeps.key'],
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.map((row) => row.prompt).sort()).toEqual([
      'Is the guard fitted?',
      'Is the machine guard fitted and secured?',
    ]);
    expect(new Set(rows.map((row) => row.template_version_id))).toEqual(
      new Set([version.template_version_id, second.template_version_id]),
    );
  });

  it('registra solo el item_key que la revisión estrena', async () => {
    const { version } = await publishedTemplate('kept.key');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    const createdAt = await itemCreatedAt('kept.key');

    await templates.saveDraft(asCoordinator(), revision.id, {
      name: revision.name,
      document: {
        sections: [
          {
            section_key: 'guarding',
            section_title: 'Guarding',
            items: [
              ...usableDocument('kept.key').sections[0]!.items,
              {
                item_key: 'brand.new.key',
                prompt: 'Is the interlock working?',
                required: true,
                response_type: 'yes_no',
                fails_on: 'no',
              },
            ],
          },
        ],
      },
      site_ids: [SITE],
    });

    await templates.publishDraft(asCoordinator(), revision.id);

    expect(await itemTemplate('brand.new.key')).toBe(version.template_id);
    // La fila del concepto viejo es su origen: reescribirla reescribiría desde cuándo se pregunta.
    expect(await itemCreatedAt('kept.key')).toEqual(createdAt);
  });

  it('un item_key de otra plantilla frena la publicación entera', async () => {
    const foreign = await createTemplate(db.migrator, 'foreign-owner', 'Foreign owner');
    await registerItems(db.migrator, foreign, ['foreign.key']);

    const { version } = await publishedTemplate('stolen.check');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await templates.saveDraft(asCoordinator(), revision.id, {
      name: revision.name,
      document: usableDocument('foreign.key'),
      site_ids: [SITE],
    });

    await expect(templates.publishDraft(asCoordinator(), revision.id)).rejects.toMatchObject({
      response: { code: 'template_item_key_taken' },
    });

    expect(await highestVersion(version.template_id)).toBe(1);
    expect((await templates.getDraft(asCoordinator(), revision.id)).id).toBe(revision.id);
  });

  it('un item_key desactivado frena la publicación y se nombra', async () => {
    const { version } = await publishedTemplate('retired.key');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await inScope(
      db.migrator,
      [SITE],
      'UPDATE template_item SET deactivated_at = now() WHERE item_key = $1',
      ['retired.key'],
    );

    try {
      await expect(templates.publishDraft(asCoordinator(), revision.id)).rejects.toMatchObject({
        response: { code: 'template_item_deactivated', item_keys: ['retired.key'] },
      });

      expect(await highestVersion(version.template_id)).toBe(1);
    } finally {
      await inScope(
        db.migrator,
        [SITE],
        'UPDATE template_item SET deactivated_at = NULL WHERE item_key = $1',
        ['retired.key'],
      );
    }
  });

  it('la pregunta que la revisión omite queda ausente, no desactivada', async () => {
    const { version } = await publishedTemplate('dropped.key');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await templates.saveDraft(asCoordinator(), revision.id, {
      name: revision.name,
      document: usableDocument('kept.alongside.dropped'),
      site_ids: [SITE],
    });

    const second = await templates.publishDraft(asCoordinator(), revision.id);

    const rows = await inScope<{ item_key: string }>(
      db.app,
      [SITE],
      'SELECT item_key FROM template_version_item WHERE template_version_id = $1',
      [second.template_version_id],
    );

    expect(rows.map((row) => row.item_key)).toEqual(['kept.alongside.dropped']);
    // Deja de ofrecerse en versiones nuevas; no se borra ni se retira.
    expect(await itemDeactivated('dropped.key')).toBe(false);
    expect(await itemTemplate('dropped.key')).toBe(version.template_id);
  });

  it('publicar una revisión no le concede UPDATE sobre el modelo publicado a nadie', async () => {
    const { version } = await publishedTemplate('no.update.granted');

    await expect(
      inScope(db.app, [SITE], `UPDATE template SET name = 'Renamed' WHERE id = $1`, [
        version.template_id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });
});

describe('la identidad de la plantilla no se corrige revisándola', () => {
  it('renombrar una revisión se rechaza', async () => {
    const { version } = await publishedTemplate('rename.locked');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    await expect(
      templates.saveDraft(asCoordinator(), revision.id, {
        name: 'A completely different name',
        document: revision.document,
        site_ids: [SITE],
      }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_locked' } });

    expect((await templates.getDraft(asCoordinator(), revision.id)).name).toBe(revision.name);
  });

  it('guardar la revisión con su mismo nombre funciona pese a que la plantilla lo ocupa', async () => {
    const { version } = await publishedTemplate('same.name.saves');
    const revision = await templates.reviseTemplate(asCoordinator(), version.template_id);

    const saved = await templates.saveDraft(asCoordinator(), revision.id, {
      name: revision.name,
      document: usableDocument('same.name.saves'),
      site_ids: [SITE],
    });

    expect(saved.template_id).toBe(version.template_id);
  });

  it('una revisión viva no le reserva el nombre a nadie más de lo que ya lo reserva su plantilla', async () => {
    const { version } = await publishedTemplate('scoped.name');
    await templates.reviseTemplate(asCoordinator(), version.template_id);

    const other = await templates.createDraft(asCoordinator(), { name: 'An unrelated template' });

    expect(other.template_id).toBeNull();
    expect(other.next_version).toBe(1);
  });
});

async function publishedRowCounts(): Promise<Record<string, string>> {
  const rows = await inScope<Record<string, string>>(
    db.app,
    [SITE],
    `SELECT (SELECT count(*) FROM template)::text              AS templates,
            (SELECT count(*) FROM template_item)::text         AS items,
            (SELECT count(*) FROM template_version)::text      AS versions,
            (SELECT count(*) FROM template_version_item)::text AS version_items`,
  );

  return one(rows);
}

async function highestVersion(templateId: string): Promise<number> {
  const rows = await inScope<{ highest: number }>(
    db.app,
    [SITE],
    'SELECT coalesce(max(version), 0)::int AS highest FROM template_version WHERE template_id = $1',
    [templateId],
  );

  return one(rows).highest;
}

async function itemCreatedAt(itemKey: string): Promise<Date> {
  const rows = await inScope<{ created_at: Date }>(
    db.app,
    [SITE],
    'SELECT created_at FROM template_item WHERE item_key = $1',
    [itemKey],
  );

  return one(rows).created_at;
}

async function itemTemplate(itemKey: string): Promise<string> {
  const rows = await inScope<{ template_id: string }>(
    db.app,
    [SITE],
    'SELECT template_id FROM template_item WHERE item_key = $1',
    [itemKey],
  );

  return one(rows).template_id;
}

async function itemDeactivated(itemKey: string): Promise<boolean> {
  const rows = await inScope<{ deactivated: boolean }>(
    db.app,
    [SITE],
    'SELECT deactivated_at IS NOT NULL AS deactivated FROM template_item WHERE item_key = $1',
    [itemKey],
  );

  return one(rows).deactivated;
}
