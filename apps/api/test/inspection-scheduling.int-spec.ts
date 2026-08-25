import type { TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import {
  createSchedule,
  inScopeAs,
  scheduleInspection,
  scheduledById,
  type ScheduledRow,
} from './helpers/inspections';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Lo que el MOTOR rechaza. Los caminos felices son de los specs de servicio; acá se
 * prueba que las invariantes no dependen de que el código de aplicación se acuerde.
 *
 * La propiedad central del change: `template_version_id` solo puede avanzar antes del
 * envío y sobre un período vivo. Se prueba que la aplicación puede hacer el avance, que
 * el trigger rechaza todos los movimientos inválidos, y que publicar no avanza nada.
 */

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';
const HS_FROZEN = 'HS001';

const SITE_A = '9a000000-0000-4000-8000-000000000001';
const SITE_B = '9a000000-0000-4000-8000-000000000002';

let db: TestDatabase;

/** Plantilla A: la que se programa. Plantilla B: la de la FK compuesta. */
let templateA: string;
let templateB: string;
let versionA1: string;
let versionB1: string;
let archiveTemplateA: string;
let archiveTemplateB: string;
let archiveTemplateC: string;

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

  await registerSite(db.migrator, SITE_A, 'site-a');
  await registerSite(db.migrator, SITE_B, 'site-b');

  templateA = await createTemplate(db.migrator, 'scheduling-a');
  templateB = await createTemplate(db.migrator, 'scheduling-b');
  archiveTemplateA = await createTemplate(db.migrator, 'scheduling-archive-a');
  archiveTemplateB = await createTemplate(db.migrator, 'scheduling-archive-b');
  archiveTemplateC = await createTemplate(db.migrator, 'scheduling-archive-c');

  await registerItems(db.migrator, templateA, ['a.guard']);
  await registerItems(db.migrator, templateB, ['b.guard']);

  versionA1 = await publishVersion(db.migrator, templateA, 1, documentFor('a.guard'));
  versionB1 = await publishVersion(db.migrator, templateB, 1, documentFor('b.guard'));
}, 180_000);

afterAll(async () => {
  await db.stop();
});

describe('el período', () => {
  it('rechaza un inicio que no es el primero del mes', async () => {
    await expect(
      scheduleInspection(db.app, {
        siteId: SITE_A,
        periodStart: '2026-08-15',
        templateId: templateA,
        templateVersionId: versionA1,
      }),
    ).rejects.toSatisfy((error) => sqlstate(error) === CHECK_VIOLATION);
  });

  it('deriva el fin como el último día del mes, incluido febrero bisiesto', async () => {
    const ordinary = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-02-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    const leap = await scheduleInspection(db.app, {
      siteId: SITE_B,
      periodStart: '2028-02-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    expect((await scheduledById(db.app, [SITE_A], ordinary)).period_end).toBe('2026-02-28');
    expect((await scheduledById(db.app, [SITE_B], leap)).period_end).toBe('2028-02-29');
  });
});

describe('la versión congelada', () => {
  let inspectionId: string;
  let submittedInspectionId: string;
  let cancelledInspectionId: string;
  let untouchedInspectionId: string;
  let versionA2: string;

  beforeAll(async () => {
    inspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-03-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    submittedInspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-04-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    cancelledInspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2027-05-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    untouchedInspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-12-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    await registerItems(db.migrator, templateA, ['a.exits']);
    versionA2 = await publishVersion(db.migrator, templateA, 2, documentFor('a.exits'));

    const submittedBy = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO inspection
         (site_id, scheduled_inspection_id, template_version_id, client_submission_id,
          submitted_by, signed_at, answer_count)
       VALUES ($1, $2, $3, gen_random_uuid(), $4, now(), 0)`,
      [SITE_A, submittedInspectionId, versionA1, submittedBy.accountId],
    );

    await inScope(
      db.app,
      [SITE_A],
      `UPDATE scheduled_inspection
          SET cancelled_at = now(), cancellation_reason = 'plant shutdown'
        WHERE id = $1`,
      [cancelledInspectionId],
    );
  });

  it('hs_app puede avanzar a una versión más alta y la fila la refleja', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        'UPDATE scheduled_inspection SET template_version_id = $2 WHERE id = $1',
        [inspectionId, versionA2],
      ),
    ).resolves.toBeDefined();

    const row = await scheduledById(db.app, [SITE_A], inspectionId);
    expect(row.template_version_id).toBe(versionA2);
  });

  it('rechaza retroceder incluso para el rol dueño', async () => {
    await expect(
      inScope(
        db.migrator,
        [SITE_A],
        'UPDATE scheduled_inspection SET template_version_id = $2 WHERE id = $1',
        [inspectionId, versionA1],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);
  });

  it('rechaza mover una inspección ya enviada', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        'UPDATE scheduled_inspection SET template_version_id = $2 WHERE id = $1',
        [submittedInspectionId, versionA2],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);
  });

  it('rechaza mover una inspección cancelada', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        'UPDATE scheduled_inspection SET template_version_id = $2 WHERE id = $1',
        [cancelledInspectionId, versionA2],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);
  });

  it('publicar una versión nueva no toca ninguna fila ya programada', async () => {
    const before = await scheduledById(db.app, [SITE_A], untouchedInspectionId);
    const after = await scheduledById(db.app, [SITE_A], untouchedInspectionId);

    expect(after).toEqual(before);
    expect(after.template_version_id).toBe(versionA1);
    expect(after.template_version_id).not.toBe(versionA2);
  });

  it('rechaza una versión que pertenece a otra plantilla', async () => {
    await expect(
      scheduleInspection(db.app, {
        siteId: SITE_A,
        periodStart: '2026-11-01',
        templateId: templateA,
        templateVersionId: versionB1,
      }),
    ).rejects.toSatisfy((error) => sqlstate(error) === FOREIGN_KEY_VIOLATION);
  });
});

describe('el único parcial del período abierto', () => {
  it('rechaza una segunda inspección del mismo sitio, plantilla y período', async () => {
    await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-05-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    await expect(
      scheduleInspection(db.app, {
        siteId: SITE_A,
        periodStart: '2026-05-01',
        templateId: templateA,
        templateVersionId: versionA1,
      }),
    ).rejects.toSatisfy((error) => sqlstate(error) === UNIQUE_VIOLATION);
  });

  it('deja reprogramar el período cuando la anterior está cancelada', async () => {
    const first = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-06-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    await inScope(
      db.app,
      [SITE_A],
      `UPDATE scheduled_inspection
          SET cancelled_at = now(), cancellation_reason = 'plant shutdown'
        WHERE id = $1`,
      [first],
    );

    const second = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-06-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    expect(second).not.toBe(first);

    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM scheduled_inspection
        WHERE site_id = $1 AND period_start = '2026-06-01'::date`,
      [SITE_A],
    );

    expect(one(rows).count).toBe('2');
  });

  it('el mismo período en la otra planta no choca', async () => {
    await expect(
      scheduleInspection(db.app, {
        siteId: SITE_B,
        periodStart: '2026-05-01',
        templateId: templateA,
        templateVersionId: versionA1,
      }),
    ).resolves.toEqual(expect.any(String));
  });
});

describe('la cancelación', () => {
  let inspectionId: string;

  beforeAll(async () => {
    inspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-07-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });
  });

  it('exige motivo', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'UPDATE scheduled_inspection SET cancelled_at = now() WHERE id = $1', [
        inspectionId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === CHECK_VIOLATION);
  });

  it('no se deshace', async () => {
    await inScope(
      db.app,
      [SITE_A],
      `UPDATE scheduled_inspection
          SET cancelled_at = now(), cancellation_reason = 'template withdrawn'
        WHERE id = $1`,
      [inspectionId],
    );

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `UPDATE scheduled_inspection
            SET cancelled_at = NULL, cancellation_reason = NULL
          WHERE id = $1`,
        [inspectionId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);
  });
});

describe('lo que ninguna de las tres tablas admite', () => {
  it('no admite DELETE, y lo frenan las DOS barreras', async () => {
    const id = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-09-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    const scheduleId = await createSchedule(db.app, SITE_B, templateB);

    // Al rol de la aplicación le falta el privilegio: nunca llega al trigger.
    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM scheduled_inspection WHERE id = $1', [id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    await expect(
      inScope(db.app, [SITE_B], 'DELETE FROM inspection_schedule WHERE id = $1', [scheduleId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    // El dueño sí lo tiene, y por eso hace falta la segunda barrera. Sin ella,
    // "nunca DELETE" sería "nunca DELETE desde la API".
    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM scheduled_inspection WHERE id = $1', [id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);

    await expect(
      inScope(db.migrator, [SITE_B], 'DELETE FROM inspection_schedule WHERE id = $1', [scheduleId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === HS_FROZEN);

    // Y la fila sigue ahí.
    expect((await scheduledById(db.app, [SITE_A], id)).id).toBe(id);
  });

  it('no admite una segunda regla activa para la misma planta y plantilla', async () => {
    await createSchedule(db.app, SITE_A, templateB);

    await expect(createSchedule(db.app, SITE_A, templateB)).rejects.toSatisfy(
      (error) => sqlstate(error) === UNIQUE_VIOLATION,
    );
  });

  it('deja recrear una regla desactivada', async () => {
    const first = await createSchedule(db.app, SITE_B, templateA);

    await inScope(db.app, [SITE_B], 'UPDATE inspection_schedule SET deactivated_at = now() WHERE id = $1', [
      first,
    ]);

    await expect(createSchedule(db.app, SITE_B, templateA)).resolves.toEqual(expect.any(String));
  });
});

describe('las barreras del archivo de requisitos', () => {
  it('rechaza archivar una regla activa por CHECK', async () => {
    const id = await createSchedule(db.app, SITE_A, archiveTemplateA);

    await expect(
      inScope(db.app, [SITE_A], 'UPDATE inspection_schedule SET archived_at = now() WHERE id = $1', [
        id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === CHECK_VIOLATION);
  });

  it('permite archivar y restaurar solo la columna concedida', async () => {
    const id = await createSchedule(db.app, SITE_B, archiveTemplateB);
    await inScope(
      db.app,
      [SITE_B],
      'UPDATE inspection_schedule SET deactivated_at = now(), archived_at = now() WHERE id = $1',
      [id],
    );

    const archived = await inScope<{ archived_at: Date | null }>(
      db.app,
      [SITE_B],
      'SELECT archived_at FROM inspection_schedule WHERE id = $1',
      [id],
    );
    expect(one(archived).archived_at).not.toBeNull();

    await inScope(db.app, [SITE_B], 'UPDATE inspection_schedule SET archived_at = NULL WHERE id = $1', [
      id,
    ]);
    const restored = await inScope<{ archived_at: Date | null }>(
      db.app,
      [SITE_B],
      'SELECT archived_at FROM inspection_schedule WHERE id = $1',
      [id],
    );
    expect(one(restored).archived_at).toBeNull();
  });

  it('mantiene el archivo aislado por RLS', async () => {
    const id = await createSchedule(db.app, SITE_A, archiveTemplateC);
    await inScope(db.app, [SITE_A], 'UPDATE inspection_schedule SET deactivated_at = now() WHERE id = $1', [
      id,
    ]);

    const updated = await inScope(
      db.app,
      [SITE_B],
      'UPDATE inspection_schedule SET archived_at = now() WHERE id = $1 RETURNING id',
      [id],
    );
    expect(updated).toHaveLength(0);
  });
});

describe('el aislamiento por sitio', () => {
  let inspectionId: string;

  beforeAll(async () => {
    inspectionId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2026-10-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });
  });

  it('no devuelve nada sin alcance declarado', async () => {
    const rows = await inScope<ScheduledRow>(
      db.app,
      [],
      'SELECT id FROM scheduled_inspection WHERE id = $1',
      [inspectionId],
    );

    expect(rows).toHaveLength(0);
  });

  it('no devuelve nada con el alcance de la otra planta', async () => {
    const rows = await inScope<ScheduledRow>(
      db.app,
      [SITE_B],
      'SELECT id FROM scheduled_inspection WHERE id = $1',
      [inspectionId],
    );

    expect(rows).toHaveLength(0);
  });

  it('rechaza insertar en una planta fuera del alcance', async () => {
    const rows = await inScope(
      db.app,
      [SITE_B],
      `INSERT INTO scheduled_inspection
         (site_id, period_start, period_months, template_id, template_version_id)
       VALUES ($1, '2026-11-01'::date, 1, $2, $3)
       RETURNING id`,
      [SITE_A, templateA, versionA1],
    ).catch((error: unknown) => error);

    // La política rechaza el WITH CHECK; el mensaje es de RLS, no de una comprobación
    // que alguien tuvo que acordarse de escribir en el endpoint.
    expect(rows).toBeInstanceOf(Error);
  });
});

describe('la auditoría', () => {
  it('registra alta, reasignación y cancelación con el actor y los dos valores', async () => {
    const inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    const other = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    const coordinator = await createAccount(db.app, { siteIds: [SITE_A], role: 'hs_coordinator' });

    const id = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2027-01-01',
      templateId: templateA,
      templateVersionId: versionA1,
      inspectorId: inspector.accountId,
      scheduledBy: coordinator.accountId,
    });

    await inScopeAs(
      db.app,
      [SITE_A],
      coordinator.accountId,
      'UPDATE scheduled_inspection SET inspector_id = $2 WHERE id = $1',
      [id, other.accountId],
    );

    const entries = await inScope<{ event_type: string; payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT event_type, payload FROM audit_log
        WHERE site_id = $1 AND payload->>'scheduled_inspection_id' = $2
        ORDER BY seq`,
      [SITE_A, id],
    );

    expect(entries.map((entry) => entry.event_type)).toEqual([
      'inspection.scheduled',
      'inspection.reassigned',
    ]);

    const reassigned = entries[1];
    expect(reassigned?.payload.previous_inspector_id).toBe(inspector.accountId);
    expect(reassigned?.payload.inspector_id).toBe(other.accountId);
  });

  it('deja el actor en nulo cuando no hay nadie detrás: el sistema actuó', async () => {
    const id = await scheduleInspection(db.app, {
      siteId: SITE_B,
      periodStart: '2027-02-01',
      templateId: templateA,
      templateVersionId: versionA1,
    });

    const entries = await inScope<{ actor_user_id: string | null }>(
      db.app,
      [SITE_B],
      `SELECT actor_user_id FROM audit_log
        WHERE site_id = $1 AND payload->>'scheduled_inspection_id' = $2`,
      [SITE_B, id],
    );

    expect(one(entries).actor_user_id).toBeNull();
  });
});
