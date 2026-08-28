import type { TemplateDraftDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbService } from '../src/db/db.service';
import { TemplatesService } from '../src/templates/templates.service';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { inScope, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * Retirar una plantilla del catálogo y devolverla (migración 0033).
 *
 * POR QUÉ ESTO ES INTEGRACIÓN Y NO UNITARIO:
 *
 *   - **El privilegio es por COLUMNA.** `0033` concede `UPDATE (deactivated_at)` y nada más.
 *     Que `name` siga fuera del alcance de hs_app no lo dice el servicio —que ni lo
 *     intenta—, lo dice el motor con `42501`, y es la mitad de la garantía de ADR-002.
 *   - **La identidad la protege un trigger.** `template_guard` rechaza tocar `key`, y eso
 *     alcanza también a hs_migrator, que entra por arriba de los privilegios.
 *   - **La carrera la arbitra el propio UPDATE.** No hay `SELECT` previo: la segunda baja no
 *     encuentra fila y por eso puede distinguirse de la primera. Con dos réplicas, un
 *     `SELECT` que preguntara antes respondería que no a las dos.
 *   - **Las dos poblaciones tienen que discrepar.** `list()` filtra las retiradas y
 *     `listPublished()` no: si las dos consultas contestaran lo mismo, o se ofrecería una
 *     plantilla retirada al programar, o no habría forma de reactivarla.
 */

const INSUFFICIENT_PRIVILEGE = '42501';
const HS_GUARD = 'HS001';
const CHECK_VIOLATION = '23514';

const SITE = 'd8000000-0000-4000-8000-000000000001';
const MISSING = 'd8000000-0000-4000-8000-0000000000ff';

let db: TestDatabase;
let dbService: DbService;
let templates: TemplatesService;

let coordinatorId: string;
let supervisorId: string;

const asCoordinator = () => ({ userId: coordinatorId, role: 'hs_coordinator', siteIds: [SITE] });
const asSupervisor = () => ({ userId: supervisorId, role: 'supervisor', siteIds: [SITE] });

/** Una sección con un ítem: el borrador publicable más chico que existe. */
function usableDocument(itemKey: string): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Guarding',
        items: [
          {
            item_key: itemKey,
            prompt: 'Is the guard fitted?',
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
          },
        ],
      },
    ],
  };
}

let published = 0;

/** Publicada por el mismo camino que usa el coordinador, no sembrada a mano. */
async function publishedTemplate(): Promise<{ templateId: string; name: string }> {
  published += 1;

  const draft = await templates.createDraft(asCoordinator(), {
    name: `Retirable inspection ${published}`,
  });

  await templates.saveDraft(asCoordinator(), draft.id, {
    name: draft.name,
    document: usableDocument(`retirable.${published}`),
    site_ids: [SITE],
  });

  const version = await templates.publishDraft(asCoordinator(), draft.id);

  return { templateId: version.template_id, name: draft.name };
}

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  templates = new TemplatesService(dbService);

  await registerSite(db.migrator, SITE, 'retiring', 'Retiring');

  coordinatorId = (await createAccount(db.app, { siteIds: [SITE], role: 'hs_coordinator' }))
    .accountId;
  supervisorId = (await createAccount(db.app, { siteIds: [SITE], role: 'supervisor' })).accountId;
}, 120_000);

afterAll(async () => {
  await dbService?.onModuleDestroy();
  await db?.stop();
});

describe('retirar del catálogo', () => {
  it('la saca de lo programable sin sacarla de la consola', async () => {
    const { templateId } = await publishedTemplate();

    await templates.deactivate(asCoordinator(), templateId);

    const offerable = await templates.list(asCoordinator());
    const catalog = await templates.listPublished(asCoordinator());

    expect(offerable.map((item) => item.id)).not.toContain(templateId);

    const row = catalog.find((item) => item.id === templateId);

    expect(row).toBeDefined();
    expect(row?.deactivated_at).not.toBeNull();
  });

  /** Sin esto, retirar sería una puerta de una sola dirección. */
  it('vuelve a ofrecerse al reactivarla', async () => {
    const { templateId } = await publishedTemplate();

    await templates.deactivate(asCoordinator(), templateId);
    await templates.reactivate(asCoordinator(), templateId);

    const offerable = await templates.list(asCoordinator());
    const row = (await templates.listPublished(asCoordinator())).find(
      (item) => item.id === templateId,
    );

    expect(offerable.map((item) => item.id)).toContain(templateId);
    expect(row?.deactivated_at).toBeNull();
  });

  it('la segunda baja se entera de que llegó tarde, en vez de contestar que la hizo ella', async () => {
    const { templateId } = await publishedTemplate();

    await templates.deactivate(asCoordinator(), templateId);

    await expect(templates.deactivate(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_already_deactivated' },
    });
    await expect(templates.reactivate(asCoordinator(), MISSING)).rejects.toMatchObject({
      response: { code: 'template_not_found' },
    });
  });

  it('reactivar una que nunca se retiró tampoco es un 200', async () => {
    const { templateId } = await publishedTemplate();

    await expect(templates.reactivate(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_not_deactivated' },
    });
  });

  /**
   * La revisión ya filtraba por `deactivated_at` antes de que existiera esta pantalla; lo que
   * comprueba este caso es que la baja alcanza a esa puerta también. Es lo que justifica que
   * la fila retirada no ofrezca "Edit template".
   */
  it('una retirada no se puede revisar', async () => {
    const { templateId } = await publishedTemplate();

    await templates.deactivate(asCoordinator(), templateId);

    await expect(templates.reviseTemplate(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_not_found' },
    });
  });
});

describe('quién puede', () => {
  it('las tres rutas son del coordinador', async () => {
    const { templateId } = await publishedTemplate();

    await expect(templates.listPublished(asSupervisor())).rejects.toMatchObject({
      response: { code: 'template_draft_forbidden' },
    });
    await expect(templates.deactivate(asSupervisor(), templateId)).rejects.toMatchObject({
      response: { code: 'template_draft_forbidden' },
    });
    await expect(templates.reactivate(asSupervisor(), templateId)).rejects.toMatchObject({
      response: { code: 'template_draft_forbidden' },
    });
    await expect(templates.archive(asSupervisor(), templateId)).rejects.toMatchObject({
      response: { code: 'template_draft_forbidden' },
    });
    await expect(templates.restore(asSupervisor(), templateId)).rejects.toMatchObject({
      response: { code: 'template_draft_forbidden' },
    });
  });

  /** El otro listado sigue abierto: lo consume `/scheduling` para todos los roles. */
  it('el listado de lo programable no se gateó', async () => {
    await expect(templates.list(asSupervisor())).resolves.toBeInstanceOf(Array);
  });
});

describe('archivar plantillas retiradas', () => {
  it('archiva una retirada sin cambiar lo programable', async () => {
    const { templateId } = await publishedTemplate();
    const before = await templates.list(asCoordinator());

    await templates.deactivate(asCoordinator(), templateId);
    const afterDeactivation = await templates.list(asCoordinator());
    await templates.archive(asCoordinator(), templateId);

    const catalog = await templates.listPublished(asCoordinator());
    const row = catalog.find((item) => item.id === templateId);

    expect(row?.archived_at).not.toBeNull();
    expect(row?.deactivated_at).not.toBeNull();
    expect(await templates.list(asCoordinator())).toEqual(afterDeactivation);
    expect(afterDeactivation).not.toEqual(before);
  });

  it('rechaza archivar una activa y archivar dos veces', async () => {
    const active = await publishedTemplate();

    await expect(templates.archive(asCoordinator(), active.templateId)).rejects.toMatchObject({
      response: { code: 'template_not_deactivated' },
    });

    await templates.deactivate(asCoordinator(), active.templateId);
    await templates.archive(asCoordinator(), active.templateId);

    await expect(templates.archive(asCoordinator(), active.templateId)).rejects.toMatchObject({
      response: { code: 'template_already_archived' },
    });
  });

  it('restaura sin reactivar y obliga a restaurar antes de reactivar', async () => {
    const { templateId } = await publishedTemplate();

    await templates.deactivate(asCoordinator(), templateId);
    await templates.archive(asCoordinator(), templateId);

    await expect(templates.reactivate(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_archived' },
    });

    await templates.restore(asCoordinator(), templateId);
    const restored = (await templates.listPublished(asCoordinator())).find(
      (item) => item.id === templateId,
    );

    expect(restored?.archived_at).toBeNull();
    expect(restored?.deactivated_at).not.toBeNull();
    await expect(templates.restore(asCoordinator(), templateId)).rejects.toMatchObject({
      response: { code: 'template_not_archived' },
    });
  });

  it('el CHECK del motor no permite archivar una plantilla activa', async () => {
    const { templateId } = await publishedTemplate();

    await expect(
      db.migrator.query('UPDATE template SET archived_at = now() WHERE id = $1', [templateId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === CHECK_VIOLATION);
  });
});

describe('lo que el motor no deja hacer con el privilegio nuevo', () => {
  it('hs_app sigue sin poder renombrar una plantilla publicada', async () => {
    const { templateId } = await publishedTemplate();

    await expect(
      inScope(db.app, [SITE], `UPDATE template SET name = 'Renamed' WHERE id = $1`, [templateId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('ni hs_migrator puede cambiarle la clave: la identidad no se reescribe', async () => {
    const { templateId } = await publishedTemplate();

    await expect(
      db.migrator.query('UPDATE template SET key = $2 WHERE id = $1', [templateId, 'renamed-key']),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_GUARD);
  });
});
