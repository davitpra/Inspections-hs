import type { TemplateDraftDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbService } from '../src/db/db.service';
import { TemplatesService } from '../src/templates/templates.service';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { createTemplate } from './helpers/templates';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * La autoría de plantillas en borrador (etapa 8, primera mitad).
 *
 * LAS TRES PRUEBAS QUE JUSTIFICAN EL ARCHIVO, y ninguna se puede hacer contra un mock:
 *
 *   - **`template_draft` es mutable donde tiene que serlo y en ningún otro lado.** El
 *     `GRANT UPDATE` de 0016 §4 es por columna: `key` y `created_by` quedaron afuera, y que
 *     hayan quedado afuera solo lo dice Postgres.
 *   - **Borrar sigue prohibido**, para el rol de la app por privilegio y para el migrador
 *     por trigger. Es el invariante de ADR-002 sobre una tabla que, por lo demás, se
 *     reescribe cien veces.
 *   - **El lock optimista está en el `WHERE`.** Un guardado con revisión vieja tiene que
 *     rechazarse sin escribir nada, y eso depende de que el `UPDATE` y su condición sean la
 *     misma sentencia.
 *
 * Y una cuarta, que es el requisito entero: **un borrador incompleto se guarda igual** y
 * dice qué le falta.
 *
 * Lo que NO está acá: que publicar funcione. No hay publicación en este change, y la
 * comprobación de que este change no la abrió es que `hs_app` sigue sin INSERT sobre
 * `template_version` — probado abajo, porque es el permiso que 0016 tenía prohibido tocar.
 */

const INSUFFICIENT_PRIVILEGE = '42501';
const APPEND_ONLY = 'HS001';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const SITE = 'd6000000-0000-4000-8000-000000000001';

let db: TestDatabase;
let dbService: DbService;
let templates: TemplatesService;

let coordinatorId: string;
let supervisorId: string;

const asCoordinator = () => ({ userId: coordinatorId, role: 'hs_coordinator', siteIds: [SITE] });

/** Una sección con un ítem: el borrador publicable más chico que existe. */
function usableDocument(): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Guarding',
        items: [
          {
            item_key: 'guard.fitted',
            prompt: 'Is the guard fitted?',
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  };
}

let created = 0;

/** Un borrador nuevo con nombre irrepetible, para que cada test parta de lo suyo. */
async function newDraft(name?: string) {
  created += 1;

  return templates.createDraft(asCoordinator(), { name: name ?? `Monthly electrical ${created}` });
}

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  templates = new TemplatesService(dbService);

  await registerSite(db.migrator, SITE, 'drafts', 'Drafts');

  const coordinator = await createAccount(db.app, { siteIds: [SITE], role: 'hs_coordinator' });
  coordinatorId = coordinator.accountId;

  const supervisor = await createAccount(db.app, { siteIds: [SITE], role: 'supervisor' });
  supervisorId = supervisor.accountId;
}, 120_000);

afterAll(async () => {
  await dbService?.onModuleDestroy();
  await db?.stop();
});

describe('lo que el motor permite y lo que no', () => {
  it('deja actualizar el documento, el nombre y la revisión', async () => {
    const draft = await newDraft();

    const rows = await inScope<{ name: string; revision: number }>(
      db.app,
      [SITE],
      `UPDATE template_draft
          SET name = 'Renamed', document = $2::jsonb, revision = revision + 1, updated_at = now()
        WHERE id = $1
    RETURNING name, revision`,
      [draft.id, JSON.stringify(usableDocument())],
    );

    expect(one(rows).name).toBe('Renamed');
    expect(one(rows).revision).toBe(2);
  });

  it('NO deja reescribir la key: no está en el GRANT UPDATE de 0016 §4', async () => {
    const draft = await newDraft();

    await expect(
      inScope(db.app, [SITE], `UPDATE template_draft SET key = 'stolen' WHERE id = $1`, [draft.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('NO deja reescribir created_by, por la misma razón', async () => {
    const draft = await newDraft();

    await expect(
      inScope(db.app, [SITE], `UPDATE template_draft SET created_by = $2 WHERE id = $1`, [
        draft.id,
        supervisorId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('NO deja borrar con el rol de la aplicación', async () => {
    const draft = await newDraft();

    await expect(
      inScope(db.app, [SITE], `DELETE FROM template_draft WHERE id = $1`, [draft.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('tampoco deja borrar con el rol del migrador: el trigger está para eso', async () => {
    const draft = await newDraft();

    await expect(
      db.migrator.query(`DELETE FROM template_draft WHERE id = $1`, [draft.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);
  });

  it('rechaza una key que no respeta el patrón', async () => {
    await expect(
      inScope(
        db.app,
        [SITE],
        `INSERT INTO template_draft (key, name, document, created_by)
         VALUES ('Not A Key', 'x', '{"sections":[]}'::jsonb, $1)`,
        [coordinatorId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === CHECK_VIOLATION);
  });

  it('no deja dos borradores vivos con la misma key', async () => {
    const draft = await newDraft();

    await expect(
      inScope(
        db.app,
        [SITE],
        `INSERT INTO template_draft (key, name, document, created_by)
         VALUES ($1, 'Some other name', '{"sections":[]}'::jsonb, $2)`,
        [draft.key, coordinatorId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  /** El índice de 0017: es lo que hace del nombre la identidad de un borrador. */
  it('no deja dos borradores vivos con el mismo nombre, ni difiriendo en mayúsculas', async () => {
    const draft = await newDraft();

    await expect(
      inScope(
        db.app,
        [SITE],
        `INSERT INTO template_draft (key, name, document, created_by)
         VALUES ('some-other-key', $1, '{"sections":[]}'::jsonb, $2)`,
        [draft.name.toUpperCase(), coordinatorId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  /**
   * El permiso que 0016 tenía prohibido tocar. Si esto empieza a pasar, la primera
   * mitad de la etapa 8 se llevó puesta la segunda sin que nadie lo pidiera.
   */
  it('sigue sin poder insertar en template_version: 0016 no tocó el modelo publicado', async () => {
    const templateId = await createTemplate(db.migrator, 'untouched', 'Untouched');

    await expect(
      inScope(
        db.app,
        [SITE],
        `INSERT INTO template_version (template_id, version, document)
         VALUES ($1, 1, '{"sections":[]}'::jsonb)`,
        [templateId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });
});

describe('quién puede escribir plantillas', () => {
  it('lo niega a todo rol que no sea el coordinador, también en la lectura', async () => {
    for (const role of ['supervisor', 'jhsc_member', 'management', 'external_auditor']) {
      const other = { userId: supervisorId, role, siteIds: [SITE] };
      const rejected = { response: { code: 'template_draft_forbidden' } };

      await expect(templates.listDrafts(other)).rejects.toMatchObject(rejected);
      await expect(templates.createDraft(other, { name: 'Nope' })).rejects.toMatchObject(rejected);
      await expect(templates.getDraft(other, coordinatorId)).rejects.toMatchObject(rejected);
      await expect(
        templates.saveDraft(other, coordinatorId, {
          name: 'Nope',
          document: usableDocument(),
          revision: 1,
        }),
      ).rejects.toMatchObject(rejected);
      await expect(templates.discardDraft(other, coordinatorId)).rejects.toMatchObject(rejected);
    }
  });

  it('la lista no depende del alcance de sitio de quien pregunta', async () => {
    await newDraft();

    const wide = await templates.listDrafts(asCoordinator());
    const narrow = await templates.listDrafts({
      userId: coordinatorId,
      role: 'hs_coordinator',
      siteIds: [],
    });

    expect(narrow.map((draft) => draft.id)).toEqual(wide.map((draft) => draft.id));
  });
});

describe('el borrador incompleto', () => {
  it('nace vacío, guardable y no publicable', async () => {
    const draft = await newDraft();

    expect(draft.document).toEqual({ sections: [] });
    expect(draft.revision).toBe(1);
    expect(draft.publishable).toBe(false);
    expect(draft.issues.map((issue) => issue.message).join()).toContain('no sections');
  });

  it('guarda una sección sin ítems y reporta qué le falta', async () => {
    const draft = await newDraft();

    const saved = await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: { sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [] }] },
      revision: draft.revision,
    });

    expect(saved.publishable).toBe(false);
    expect(saved.issues.map((issue) => issue.message)).toContain(
      'Section "Guarding" has no items.',
    );
    expect(saved.document.sections).toHaveLength(1);
  });

  it('guarda una configuración que se contradice y la nombra', async () => {
    const draft = await newDraft();

    const saved = await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: {
        sections: [
          {
            section_key: 'guarding',
            section_title: 'Guarding',
            items: [
              {
                item_key: 'guard.level',
                prompt: 'Rate the guarding',
                required: true,
                response_type: 'scale',
                min: 5,
                max: 1,
              },
            ],
          },
        ],
      },
      revision: draft.revision,
    });

    expect(saved.publishable).toBe(false);
    expect(saved.issues.map((issue) => issue.message).join()).toContain('must be lower than');
  });

  it('reporta publishable cuando ya no le falta nada', async () => {
    const draft = await newDraft();

    const saved = await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    expect(saved.publishable).toBe(true);
    expect(saved.issues).toEqual([]);
  });

  it('el listado informa publishable sin traer el documento', async () => {
    const draft = await newDraft();

    await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    const listed = (await templates.listDrafts(asCoordinator())).find(
      (each) => each.id === draft.id,
    );

    expect(listed?.publishable).toBe(true);
    expect(listed).not.toHaveProperty('document');
  });
});

describe('el lock optimista', () => {
  it('avanza la revisión en cada guardado', async () => {
    const draft = await newDraft();

    const first = await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    expect(first.revision).toBe(2);

    const second = await templates.saveDraft(asCoordinator(), draft.id, {
      name: 'Second pass',
      document: usableDocument(),
      revision: first.revision,
    });

    expect(second.revision).toBe(3);
  });

  it('rechaza el guardado con revisión vieja y no pisa nada', async () => {
    const draft = await newDraft();

    const winner = await templates.saveDraft(asCoordinator(), draft.id, {
      name: 'Written by the first window',
      document: usableDocument(),
      revision: draft.revision,
    });

    await expect(
      templates.saveDraft(asCoordinator(), draft.id, {
        name: 'Written by the second window',
        document: { sections: [] },
        revision: draft.revision,
      }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_stale' } });

    const current = await templates.getDraft(asCoordinator(), draft.id);

    expect(current.name).toBe('Written by the first window');
    expect(current.revision).toBe(winner.revision);
  });
});

describe('descartar', () => {
  it('lo saca del listado y deja la fila con discarded_at', async () => {
    const draft = await newDraft();

    await templates.discardDraft(asCoordinator(), draft.id);

    const listed = await templates.listDrafts(asCoordinator());
    expect(listed.map((each) => each.id)).not.toContain(draft.id);

    const rows = await inScope<{ discarded_at: Date | null }>(
      db.app,
      [SITE],
      `SELECT discarded_at FROM template_draft WHERE id = $1`,
      [draft.id],
    );

    expect(one(rows).discarded_at).not.toBeNull();
  });

  it('un borrador descartado ya no se puede leer ni guardar', async () => {
    const draft = await newDraft();

    await templates.discardDraft(asCoordinator(), draft.id);

    const rejected = { response: { code: 'template_draft_not_found' } };

    await expect(templates.getDraft(asCoordinator(), draft.id)).rejects.toMatchObject(rejected);
    await expect(
      templates.saveDraft(asCoordinator(), draft.id, {
        name: draft.name,
        document: usableDocument(),
        revision: draft.revision,
      }),
    ).rejects.toMatchObject(rejected);
    await expect(templates.discardDraft(asCoordinator(), draft.id)).rejects.toMatchObject(rejected);
  });

  it('libera el nombre, y con él la key, para un borrador nuevo', async () => {
    const draft = await newDraft();

    await templates.discardDraft(asCoordinator(), draft.id);

    const reused = await templates.createDraft(asCoordinator(), { name: draft.name });

    expect(reused.key).toBe(draft.key);
    expect(reused.id).not.toBe(draft.id);
  });
});

describe('el nombre es la identidad, y la key se deriva de él', () => {
  it('la key sale del nombre y el cliente no la manda', async () => {
    const draft = await templates.createDraft(asCoordinator(), {
      name: 'Monthly electrical inspection',
    });

    expect(draft.key).toBe('monthly-electrical-inspection');
  });

  it('rechaza un nombre del que no sale ninguna key', async () => {
    await expect(
      templates.createDraft(asCoordinator(), { name: '???' }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_unusable' } });
  });

  it('rechaza un nombre que ya tiene otro borrador vivo', async () => {
    const draft = await newDraft('Fire extinguisher round');

    await expect(
      templates.createDraft(asCoordinator(), { name: draft.name }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_taken' } });
  });

  /** Dos filas que solo difieren en mayúsculas son el mismo renglón para quien lee. */
  it('ignora mayúsculas y espacios al comparar nombres', async () => {
    await newDraft('Loading dock walkaround');

    await expect(
      templates.createDraft(asCoordinator(), { name: '  loading DOCK walkaround ' }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_taken' } });
  });

  it('rechaza un nombre que ya tiene una plantilla publicada', async () => {
    await createTemplate(db.migrator, 'already-published', 'Already published');

    await expect(
      templates.createDraft(asCoordinator(), { name: 'Already published' }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_taken' } });
  });

  /**
   * Dos nombres que se ven distintos y derivan a la misma clave. Se rechaza en vez de
   * desempatar con un sufijo: si la clave se sufijara, `key = f(name)` dejaría de ser
   * cierto sin que nadie lo viera. El mensaje distingue el caso.
   */
  it('rechaza un nombre distinto que deriva a la misma key, y lo dice', async () => {
    await templates.createDraft(asCoordinator(), { name: 'Yard sweep' });

    await expect(
      templates.createDraft(asCoordinator(), { name: 'Yard  sweep!' }),
    ).rejects.toMatchObject({
      response: { code: 'template_draft_name_taken', message: expect.stringContaining('very much like') },
    });
  });

  it('un borrador descartado libera su nombre', async () => {
    const draft = await newDraft('Compressor check');
    await templates.discardDraft(asCoordinator(), draft.id);

    const reused = await templates.createDraft(asCoordinator(), { name: 'Compressor check' });

    expect(reused.key).toBe('compressor-check');
    expect(reused.id).not.toBe(draft.id);
  });
});

describe('renombrar', () => {
  it('cambia el nombre y NO mueve la key', async () => {
    const draft = await newDraft('Quarterly boiler check');

    const saved = await templates.saveDraft(asCoordinator(), draft.id, {
      name: 'Annual boiler check',
      document: usableDocument(),
      revision: draft.revision,
    });

    expect(saved.name).toBe('Annual boiler check');
    expect(saved.key).toBe('quarterly-boiler-check');
  });

  it('no deja renombrar a un nombre que ya tiene otro borrador', async () => {
    const first = await newDraft('Dust collector check');
    const second = await newDraft('Air line check');

    await expect(
      templates.saveDraft(asCoordinator(), second.id, {
        name: first.name,
        document: usableDocument(),
        revision: second.revision,
      }),
    ).rejects.toMatchObject({ response: { code: 'template_draft_name_taken' } });
  });

  it('guardar sin cambiar el nombre no choca consigo mismo', async () => {
    const draft = await newDraft('Ladder inspection');

    const saved = await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    expect(saved.name).toBe('Ladder inspection');
  });
});

describe('las dos poblaciones no se tocan', () => {
  it('un borrador completo no aparece entre las plantillas programables', async () => {
    const draft = await newDraft('Never published anywhere');

    await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    const offered = await templates.list(asCoordinator());

    expect(offered.map((option) => option.name)).not.toContain('Never published anywhere');
  });

  it('crear y guardar borradores no escribe una sola fila en el modelo publicado', async () => {
    const before = await countPublished();

    const draft = await newDraft();
    await templates.saveDraft(asCoordinator(), draft.id, {
      name: draft.name,
      document: usableDocument(),
      revision: draft.revision,
    });

    expect(await countPublished()).toEqual(before);
  });
});

async function countPublished(): Promise<Record<string, string>> {
  const rows = await inScope<Record<string, string>>(
    db.app,
    [SITE],
    `SELECT (SELECT count(*) FROM template)              AS templates,
            (SELECT count(*) FROM template_item)         AS items,
            (SELECT count(*) FROM template_version)      AS versions,
            (SELECT count(*) FROM template_version_item) AS version_items`,
  );

  return one(rows);
}
