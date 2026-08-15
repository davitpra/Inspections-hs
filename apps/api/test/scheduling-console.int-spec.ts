import type { TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COMPLIANCE_PERIODS_SQL } from '../src/reporting/compliance.sql';
import { SitesService } from '../src/catalog/sites.service';
import { TemplatesService } from '../src/templates/templates.service';
import { registerSite } from './helpers/catalog';
import { createAccount, type SeededAccount } from './helpers/identity';
import { createSchedule, scheduleInspection } from './helpers/inspections';
import { inScope, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * La consola de programación: las tres lecturas de apoyo y las propiedades que hacen que
 * la pantalla no pueda ofrecer algo que el servidor después rechaza.
 *
 * LA PRUEBA QUE JUSTIFICA EL ARCHIVO es «todo lo que la lista ofrece, la asignación lo
 * acepta». El resto son sus bordes: quién puede pedirla, qué queda afuera, y el caso
 * incómodo del `LEFT JOIN` —una cuenta elegible cuya persona vive en la otra planta—,
 * que un `INNER JOIN` haría desaparecer sin error y sin síntoma.
 *
 * Lo que el motor rechaza sigue estando en `inspection-scheduling.int-spec.ts`.
 */

const SITE_A = '9c000000-0000-4000-8000-000000000001';
const SITE_B = '9c000000-0000-4000-8000-000000000002';
const SITE_CLOSED = '9c000000-0000-4000-8000-000000000003';

let db: TestDatabase;
let stack: SchedulingStack;
let sites: SitesService;
let templates: TemplatesService;

let templateId: string;
let templateV2: string;
let unpublishedTemplateId: string;

let coordinator: SeededAccount;
let coordinatorB: SeededAccount;
let inspector: SeededAccount;

const session = (account: SeededAccount, role: string, siteIds: readonly string[]) => ({
  userId: account.accountId,
  role,
  siteIds,
});

function documentFor(itemKey: string): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: itemKey,
            prompt: 'Is the guard in place?',
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
  sites = new SitesService(stack.db);
  templates = new TemplatesService(stack.db);

  await registerSite(db.migrator, SITE_A, 'console-a', 'Console A');
  await registerSite(db.migrator, SITE_B, 'console-b', 'Console B');
  await registerSite(db.migrator, SITE_CLOSED, 'console-closed', 'Console Closed');
  await inScope(db.migrator, [], 'UPDATE site SET deactivated_at = now() WHERE id = $1', [
    SITE_CLOSED,
  ]);

  templateId = await createTemplate(db.migrator, 'console-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ['c.guard']);
  await publishVersion(db.migrator, templateId, 1, documentFor('c.guard'));
  templateV2 = await publishVersion(db.migrator, templateId, 2, documentFor('c.guard'));

  // Sin ninguna `template_version`: es la que el listado no puede ofrecer.
  unpublishedTemplateId = await createTemplate(db.migrator, 'console-draft', 'Never published');

  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_CLOSED],
    role: 'hs_coordinator',
  });
  coordinatorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'hs_coordinator' });
  inspector = await createAccount(db.app, {
    siteIds: [SITE_A],
    role: 'jhsc_member',
    firstName: 'Dana',
    lastName: 'Okafor',
  });
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('los candidatos a inspector', () => {
  const asCoordinator = () => session(coordinator, 'hs_coordinator', [SITE_A, SITE_CLOSED]);

  it('devuelve al jhsc_member con alcance vigente, con su nombre', async () => {
    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);

    const found = rows.find((row) => row.id === inspector.accountId);
    expect(found).toBeDefined();
    expect(found?.first_name).toBe('Dana');
    expect(found?.last_name).toBe('Okafor');
  });

  /**
   * LA PROPIEDAD CENTRAL. Cada cuenta que la lista ofrece se asigna de verdad contra una
   * inspección real, y ninguna es rechazada. Es lo que garantiza que el selector de la
   * pantalla no pueda producir un `inspector_invalid`.
   */
  it('todo lo que ofrece, la asignación lo acepta', async () => {
    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-03-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    const candidates = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      const updated = await stack.inspections.assignInspector(
        asCoordinator(),
        scheduledId,
        candidate.id,
      );

      expect(updated.inspector_id).toBe(candidate.id);
    }
  });

  it('no ofrece a quien no es jhsc_member, y asignarlo se rechaza', async () => {
    const manager = await createAccount(db.app, { siteIds: [SITE_A], role: 'management' });

    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(rows.map((row) => row.id)).not.toContain(manager.accountId);

    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-04-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    await expect(
      stack.inspections.assignInspector(asCoordinator(), scheduledId, manager.accountId),
    ).rejects.toMatchObject({ code: 'inspector_invalid' });
  });

  it('no ofrece a la cuenta desactivada', async () => {
    const gone = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      gone.accountId,
    ]);

    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(rows.map((row) => row.id)).not.toContain(gone.accountId);
  });

  it('no ofrece a quien tiene el alcance revocado', async () => {
    const revoked = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    await inScope(
      db.migrator,
      [SITE_A],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1',
      [revoked.accountId],
    );

    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(rows.map((row) => row.id)).not.toContain(revoked.accountId);
  });

  it('no ofrece al jhsc_member que solo tiene alcance en la otra planta', async () => {
    const elsewhere = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });

    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(rows.map((row) => row.id)).not.toContain(elsewhere.accountId);
  });

  /**
   * El caso del `LEFT JOIN`. La elegibilidad se define sobre `user_site_scope`; el nombre
   * vive en `person`, que SÍ está aislada por sitio. Un inner join borraría esta cuenta
   * de la lista aunque la asignación la acepte — la lista y la validación divergirían sin
   * que nada fallara.
   */
  it('ofrece a la cuenta elegible cuya persona está en la otra planta, sin nombre', async () => {
    // Se crea con las dos plantas —hace falta para poder escribir la persona en B, que
    // `person` está aislada— y después se le revoca B. Queda lo que se quería probar y
    // es además el caso real: alguien que se mudó de planta y conserva el alcance viejo.
    const transferred = await createAccount(db.app, {
      siteIds: [SITE_A, SITE_B],
      role: 'jhsc_member',
      personSiteId: SITE_B,
      firstName: 'Robin',
      lastName: 'Vasquez',
    });

    await inScope(
      db.migrator,
      [SITE_A, SITE_B],
      'UPDATE user_site_scope SET revoked_at = now() WHERE user_id = $1 AND site_id = $2',
      [transferred.accountId, SITE_B],
    );

    const rows = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);

    const found = rows.find((row) => row.id === transferred.accountId);
    expect(found).toBeDefined();
    expect(found?.first_name).toBeNull();
    expect(found?.last_name).toBeNull();

    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-05-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    const updated = await stack.inspections.assignInspector(
      asCoordinator(),
      scheduledId,
      transferred.accountId,
    );

    expect(updated.inspector_id).toBe(transferred.accountId);
  });

  it('no se la puede pedir un jhsc_member', async () => {
    await expect(
      stack.inspections.listInspectorCandidates(
        session(inspector, 'jhsc_member', [SITE_A]),
        SITE_A,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  /**
   * `app_user` y `user_site_scope` NO llevan política de aislamiento, así que sin la
   * comprobación del endpoint un coordinador de Console B podría enumerar el JHSC de
   * Console A. Acá el endpoint es la frontera y este test es lo que la sostiene.
   */
  it('no la puede pedir un coordinador para una planta fuera de su alcance', async () => {
    await expect(
      stack.inspections.listInspectorCandidates(
        session(coordinatorB, 'hs_coordinator', [SITE_B]),
        SITE_A,
      ),
    ).rejects.toMatchObject({ code: 'inspection_not_found' });
  });
});

describe('el listado de plantas', () => {
  it('devuelve exactamente el alcance de la sesión', async () => {
    const rows = await sites.list(session(coordinator, 'hs_coordinator', [SITE_A]));

    expect(rows.map((row) => row.id)).toEqual([SITE_A]);
  });

  it('no devuelve la planta de la otra sesión', async () => {
    const rows = await sites.list(session(coordinatorB, 'hs_coordinator', [SITE_B]));

    expect(rows.map((row) => row.id)).not.toContain(SITE_A);
  });

  it('sin alcance declarado no devuelve nada', async () => {
    const rows = await sites.list(session(coordinator, 'hs_coordinator', []));

    expect(rows).toEqual([]);
  });

  // Una regla o una inspección de una planta cerrada tiene que seguir resolviendo a un
  // nombre. Filtrar acá dejaría un UUID crudo en la pantalla.
  it('devuelve la planta desactivada, marcada', async () => {
    const rows = await sites.list(session(coordinator, 'hs_coordinator', [SITE_A, SITE_CLOSED]));

    const closed = rows.find((row) => row.id === SITE_CLOSED);
    expect(closed).toBeDefined();
    expect(closed?.deactivated_at).not.toBeNull();
  });

  it('la puede leer cualquier rol dentro de su alcance', async () => {
    const rows = await sites.list(session(inspector, 'jhsc_member', [SITE_A]));

    expect(rows.map((row) => row.id)).toEqual([SITE_A]);
  });
});

describe('el listado de plantillas', () => {
  const asCoordinator = () => session(coordinator, 'hs_coordinator', [SITE_A]);

  it('omite la plantilla sin ninguna versión publicada', async () => {
    const rows = await templates.list(asCoordinator());

    expect(rows.map((row) => row.id)).not.toContain(unpublishedTemplateId);
  });

  it('rechazar esa misma plantilla al crear una regla es lo que la ausencia evita', async () => {
    await expect(
      stack.inspections.createSchedule(asCoordinator(), {
        site_id: SITE_A,
        template_id: unpublishedTemplateId,
      }),
    ).rejects.toMatchObject({ code: 'template_not_publishable' });
  });

  /**
   * La propiedad que evita el fallo silencioso: lo que el listado DICE es lo que la
   * programación CONGELA. Si fueran dos expresiones distintas, la pantalla podría
   * ofrecer la v1 mientras la inspección abre contra la v2.
   */
  it('informa la versión que la programación congela', async () => {
    const rows = await templates.list(asCoordinator());
    const offered = rows.find((row) => row.id === templateId);

    expect(offered?.latest_version).toBe(2);

    const created = await stack.inspections.schedule(asCoordinator(), {
      site_id: SITE_A,
      template_id: templateId,
      period_start: '2026-06-01',
    });

    expect(created.template_version_id).toBe(offered?.latest_version_id);
  });

  it('no depende del alcance: las dos plantas ven lo mismo', async () => {
    const forA = await templates.list(session(coordinator, 'hs_coordinator', [SITE_A]));
    const forB = await templates.list(session(coordinatorB, 'hs_coordinator', [SITE_B]));

    expect(forA.map((row) => row.id)).toEqual(forB.map((row) => row.id));
  });
});

describe('el estado en el listado de programadas', () => {
  const asCoordinator = () => session(coordinator, 'hs_coordinator', [SITE_A]);

  /**
   * ANTI-DIVERGENCIA. El listado y el reporte de cobertura derivan el estado de la misma
   * expresión; este test lo comprueba fila por fila. Si alguien vuelve a escribir el
   * `CASE` en uno de los dos lugares, esto se pone rojo.
   */
  it('coincide con el que da el reporte de cobertura para la misma fila', async () => {
    const listed = await stack.inspections.listScheduled(asCoordinator());

    const rows = await inScope(db.app, [SITE_A], COMPLIANCE_PERIODS_SQL, [
      SITE_A,
      '2026-01-01',
      '2026-12-31',
      null,
    ]);

    const fromReport = new Map(
      rows
        .filter((row) => row.scheduled_inspection_id !== null)
        .map((row) => [row.scheduled_inspection_id as string, row.status as string]),
    );

    const compared = listed.filter((entry) => fromReport.has(entry.id));
    expect(compared.length).toBeGreaterThan(0);

    for (const entry of compared) {
      expect(entry.status).toBe(fromReport.get(entry.id));
    }
  });

  it('un período cerrado sin envío es missed', async () => {
    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2020-01-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    const listed = await stack.inspections.listScheduled(asCoordinator());
    expect(listed.find((entry) => entry.id === scheduledId)?.status).toBe('missed');
  });

  it('una cancelada reporta cancelled con su motivo', async () => {
    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2020-02-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    await stack.inspections.cancel(asCoordinator(), scheduledId, 'plant shutdown');

    const listed = await stack.inspections.listScheduled(asCoordinator());
    const entry = listed.find((item) => item.id === scheduledId);

    expect(entry?.status).toBe('cancelled');
    expect(entry?.cancellation_reason).toBe('plant shutdown');
  });
});

describe('los nombres en el listado', () => {
  const asCoordinator = () => session(coordinator, 'hs_coordinator', [SITE_A]);

  it('nombra al asignado, y lo sigue nombrando después de desactivarlo', async () => {
    const leaving = await createAccount(db.app, {
      siteIds: [SITE_A],
      role: 'jhsc_member',
      firstName: 'Sam',
      lastName: 'Delacroix',
    });

    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-07-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    await stack.inspections.assignInspector(asCoordinator(), scheduledId, leaving.accountId);

    const before = await stack.inspections.listScheduled(asCoordinator());
    expect(before.find((entry) => entry.id === scheduledId)?.inspector_name).toBe('Sam Delacroix');

    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      leaving.accountId,
    ]);

    // El nombre sobrevive: la asignación es un hecho histórico.
    const after = await stack.inspections.listScheduled(asCoordinator());
    expect(after.find((entry) => entry.id === scheduledId)?.inspector_name).toBe('Sam Delacroix');

    // Y sin embargo ya no se puede volver a elegir.
    const candidates = await stack.inspections.listInspectorCandidates(asCoordinator(), SITE_A);
    expect(candidates.map((row) => row.id)).not.toContain(leaving.accountId);
  });

  it('deja el nombre en nulo cuando no hay asignado', async () => {
    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-08-01',
      templateId,
      templateVersionId: templateV2,
      scheduledBy: coordinator.accountId,
    });

    const listed = await stack.inspections.listScheduled(asCoordinator());
    const entry = listed.find((item) => item.id === scheduledId);

    expect(entry?.inspector_id).toBeNull();
    expect(entry?.inspector_name).toBeNull();
  });

  it('nombra al inspector por defecto de la regla', async () => {
    await createSchedule(db.app, SITE_A, templateId, inspector.accountId);

    const rules = await stack.inspections.listSchedules(asCoordinator());
    const rule = rules.find((item) => item.default_inspector_id === inspector.accountId);

    expect(rule?.default_inspector_name).toBe('Dana Okafor');
  });

  it('lleva el instante en que la regla se creó', async () => {
    const before = new Date();
    await createSchedule(db.app, SITE_CLOSED, templateId, inspector.accountId);
    const after = new Date();

    const rules = await stack.inspections.listSchedules(
      session(coordinator, 'hs_coordinator', [SITE_A, SITE_CLOSED]),
    );
    const rule = rules.find(
      (item) => item.site_id === SITE_CLOSED && item.default_inspector_id === inspector.accountId,
    );

    expect(rule?.created_at).toBeDefined();
    const createdAt = new Date(rule!.created_at);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('la regla duplicada', () => {
  it('se rechaza con un código y no con un fallo sin manejar', async () => {
    const asCoordinator = session(coordinatorB, 'hs_coordinator', [SITE_B]);

    await stack.inspections.createSchedule(asCoordinator, {
      site_id: SITE_B,
      template_id: templateId,
    });

    await expect(
      stack.inspections.createSchedule(asCoordinator, {
        site_id: SITE_B,
        template_id: templateId,
      }),
    ).rejects.toMatchObject({ code: 'schedule_already_active' });
  });
});
