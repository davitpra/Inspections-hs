import type { InspectionSubmission, TemplateDocument } from '@hs/contracts';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { FindingsController } from '../src/findings/findings.controller';
import { FindingsService } from '../src/findings/findings.service';
import { SubmissionsService } from '../src/inspections/submissions.service';
import { createLocation, registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §7 etapa 4 — El hallazgo.
 *
 * Lo que estos tests prueban no es que se guarden filas. Es que las propiedades que
 * hacen que R2 signifique algo se cumplan aunque el cliente se porte mal y aunque
 * alguien escriba SQL a mano:
 *
 *   1. Una respuesta negativa produce un hallazgo, y ninguna otra respuesta lo hace.
 *   2. Un envío rechazado no deja ni un hallazgo.
 *   3. Un hallazgo sin foto no llega a existir, y no por una comprobación del servicio.
 *   4. La ruta de clasificación de riesgo no está expuesta.
 */

const SITE_A = 'f1d00000-0000-4000-8000-000000000001';
const SITE_B = 'f1d00000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: SchedulingStack;
let submissions: SubmissionsService;
let findings: FindingsService;

let templateId: string;
let versionV1: string;
let versionV2: string;
let locationA: string;
let locationB: string;

let inspector: { accountId: string };
let coordinator: { accountId: string };
let supervisor: { accountId: string };
let auditor: { accountId: string };

const ITEM_KEYS = ['fnd.guards', 'fnd.eyewash', 'fnd.rating'];

function document(): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'fnd.guards',
            prompt: 'Machine guards in place',
            position: 1,
            required: true,
            response_type: 'yes_no' as const,
            fails_on: 'no' as const,
          },
          {
            item_key: 'fnd.eyewash',
            prompt: 'Eyewash flushed',
            position: 2,
            required: true,
            response_type: 'yes_no_na' as const,
            fails_on: 'no' as const,
          },
          {
            item_key: 'fnd.rating',
            prompt: 'Housekeeping rating',
            position: 3,
            required: true,
            response_type: 'scale' as const,
            min: 1,
            max: 5,
          },
        ],
      },
    ],
  };
}

const sessionFor = (accountId: string, siteIds: string[], role = 'jhsc_member') => ({
  userId: accountId,
  role,
  siteIds,
});

const keyFor = (siteId: string, inspectionId: string, name: string = randomUUID()) =>
  `${siteId}/${inspectionId}/${name}`;

function details(siteId: string, scheduledId: string, locationId: string, photos = 1) {
  return {
    description: 'Guard missing on the infeed of the packaging line',
    location_id: locationId,
    photo_object_keys: Array.from({ length: photos }, () => keyFor(siteId, scheduledId)),
  };
}

/**
 * Un envío válido con UN negativo (`fnd.guards`) y su hallazgo. Los tests lo desarman:
 * partir de algo que el servidor acepta y romperle una cosa evita que el caso roto
 * falle por otra razón.
 */
function submissionFor(
  scheduledId: string,
  siteId: string,
  templateVersionId: string,
  locationId: string,
  overrides: Partial<InspectionSubmission> = {},
): InspectionSubmission {
  return {
    client_submission_id: randomUUID(),
    scheduled_inspection_id: scheduledId,
    template_version_id: templateVersionId,
    answers: {
      'fnd.guards': false,
      'fnd.eyewash': 'yes',
      'fnd.rating': 4,
    } as InspectionSubmission['answers'],
    photos: {},
    findings: { 'fnd.guards': details(siteId, scheduledId, locationId) },
    signed_at: '2026-08-03T14:20:00-04:00',
    ...overrides,
  };
}

let periodCursor = 0;

function nextPeriod(): string {
  periodCursor += 1;
  const month = ((periodCursor - 1) % 12) + 1;
  const year = 2035 + Math.floor((periodCursor - 1) / 12);

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

async function freshInspection(
  siteId = SITE_A,
  inspectorId?: string,
  templateVersionId = versionV2,
): Promise<string> {
  return scheduleInspection(db.app, {
    siteId,
    periodStart: nextPeriod(),
    templateId,
    templateVersionId,
    inspectorId: inspectorId ?? inspector.accountId,
  });
}

interface FindingRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  origin: string;
  inspection_id: string | null;
  template_version_item_id: string | null;
  item_key: string | null;
  location_id: string;
  description: string;
  occurred_at: Date;
}

async function findingRows(siteIds: string[], inspectionId?: string): Promise<FindingRow[]> {
  return inScope<FindingRow>(
    db.app,
    siteIds,
    inspectionId
      ? `SELECT * FROM finding WHERE inspection_id = $1 ORDER BY item_key`
      : `SELECT * FROM finding ORDER BY recorded_at`,
    inspectionId ? [inspectionId] : [],
  );
}

async function photoCount(findingId: string): Promise<number> {
  const rows = await inScope<{ count: string }>(
    db.app,
    [SITE_A, SITE_B],
    'SELECT count(*)::text AS count FROM finding_photo WHERE finding_id = $1',
    [findingId],
  );

  return Number(one(rows).count);
}

async function events(siteId: string, type: string) {
  return inScope<{ seq: string; payload: Record<string, unknown>; occurred_at: Date }>(
    db.app,
    [siteId],
    `SELECT seq, payload, occurred_at FROM audit_log
      WHERE site_id = $1 AND event_type = $2 ORDER BY seq`,
    [siteId, type],
  );
}

async function chainLength(siteId: string): Promise<number> {
  const rows = await inScope<{ count: string }>(
    db.app,
    [siteId],
    'SELECT count(*)::text AS count FROM audit_log WHERE site_id = $1',
    [siteId],
  );

  return Number(one(rows).count);
}

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createSchedulingStack(db.appUrl);
  submissions = new SubmissionsService(stack.db);
  findings = new FindingsService(stack.db);

  await registerSite(db.migrator, SITE_A, 'find-a');
  await registerSite(db.migrator, SITE_B, 'find-b');

  locationA = await createLocation(db.app, SITE_A, 'dock-1', 'Dock 1');
  locationB = await createLocation(db.app, SITE_B, 'dock-1', 'Dock 1');

  templateId = await createTemplate(db.migrator, 'find-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ITEM_KEYS);

  versionV1 = await publishVersion(db.migrator, templateId, 1, document());
  versionV2 = await publishVersion(db.migrator, templateId, 2, document());

  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
  });
  supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  // El auditor externo lleva vencimiento y ventana de fechas obligatorios (§5 riesgo I).
  auditor = await createAccount(db.app, {
    siteIds: [SITE_A],
    role: 'external_auditor',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    recordsFrom: '2026-01-01',
    recordsTo: '2026-12-31',
  });
}, 120_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('la derivación', () => {
  it('crea un hallazgo por respuesta negativa, con la identidad dual y sus fotos', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA);

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);
    const rows = await findingRows([SITE_A], accepted.id);

    expect(rows).toHaveLength(1);

    const finding = one(rows);

    expect(finding.origin).toBe('inspection');
    expect(finding.item_key).toBe('fnd.guards');
    expect(finding.template_version_item_id).toEqual(expect.any(String));
    expect(finding.location_id).toBe(locationA);
    expect(finding.description).toContain('Guard missing');

    // El reloj del DISPOSITIVO, no el de la transacción (§5 riesgo C).
    expect(finding.occurred_at.toISOString()).toBe(new Date(payload.signed_at).toISOString());

    expect(await photoCount(finding.id)).toBe(1);
  });

  it('tres negativos producen tres hallazgos', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, {
      answers: {
        'fnd.guards': false,
        'fnd.eyewash': 'no',
        'fnd.rating': 1,
      } as InspectionSubmission['answers'],
      findings: {
        'fnd.guards': details(SITE_A, scheduled, locationA),
        'fnd.eyewash': details(SITE_A, scheduled, locationA, 2),
      },
    });

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);
    const rows = await findingRows([SITE_A], accepted.id);

    // Dos y no tres: `fnd.rating` es una escala en su valor más bajo y NO deriva
    // hallazgo. Sin umbral en el documento, cualquier corte sería inventado (D2).
    expect(rows.map((row) => row.item_key)).toEqual(['fnd.eyewash', 'fnd.guards']);
  });

  it('un envío sin negativos no crea ninguno, y un na tampoco', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, {
      answers: {
        'fnd.guards': true,
        'fnd.eyewash': 'na',
        'fnd.rating': 5,
      } as InspectionSubmission['answers'],
      findings: {},
    });

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    expect(await findingRows([SITE_A], accepted.id)).toHaveLength(0);
  });
});

describe('todo o nada', () => {
  it('un negativo sin detalles deja cero filas en las cuatro tablas', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, { findings: {} });
    const before = await chainLength(SITE_A);

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        violations: [{ item_key: 'fnd.guards', code: 'finding_missing' }],
      },
    });

    const inspections = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM inspection WHERE client_submission_id = $1',
      [payload.client_submission_id],
    );

    expect(Number(one(inspections).count)).toBe(0);
    expect(await chainLength(SITE_A)).toBe(before);
  });

  it('detalles para una respuesta afirmativa son unexpected_finding', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, {
      answers: {
        'fnd.guards': true,
        'fnd.eyewash': 'yes',
        'fnd.rating': 4,
      } as InspectionSubmission['answers'],
    });

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        violations: [{ item_key: 'fnd.guards', code: 'unexpected_finding' }],
      },
    });
  });

  it('las violaciones del bloque viajan junto con las del motor de formularios', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, {
      answers: {
        'fnd.guards': false,
        'fnd.eyewash': 'yes',
      } as InspectionSubmission['answers'],
      findings: {},
    });

    const failure: { violations: { item_key: string; code: string }[] } = await submissions
      .ingest(sessionFor(inspector.accountId, [SITE_A]), payload)
      .then(
        () => ({ violations: [] }),
        (error: { response: { violations: { item_key: string; code: string }[] } }) =>
          error.response,
      );

    expect(failure.violations).toEqual([
      { item_key: 'fnd.rating', code: 'required_missing' },
      { item_key: 'fnd.guards', code: 'finding_missing' },
    ]);
  });

  it('un reenvío no duplica los hallazgos', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const first = await submissions.ingest(session, payload);

    for (let i = 0; i < 4; i += 1) {
      const again = await submissions.ingest(session, payload);
      expect(again.created).toBe(false);
      expect(again.id).toBe(first.id);
    }

    expect(await findingRows([SITE_A], first.id)).toHaveLength(1);
  });
});

describe('las fotos y la ubicación', () => {
  it('una foto de hallazgo de otra inspección se rechaza', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA, {
      findings: {
        'fnd.guards': {
          description: 'Guard missing on the infeed of the packaging line',
          location_id: locationA,
          photo_object_keys: [keyFor(SITE_A, randomUUID())],
        },
      },
    });

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });
  });

  /**
   * La separación que hace que el envío sea aceptable: la foto del hallazgo NO es la
   * respuesta del ítem. Si viajara en `photos`, `mergePhotoAnswers` la fundiría bajo la
   * misma `item_key` que el booleano y el servidor rechazaría por colisión.
   */
  it('la foto del hallazgo no queda como valor de la respuesta', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA);

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    const answers = await inScope<{ value: unknown }>(
      db.app,
      [SITE_A],
      `SELECT value FROM inspection_answer WHERE inspection_id = $1 AND item_key = 'fnd.guards'`,
      [accepted.id],
    );

    expect(one(answers).value).toBe(false);
  });

  it('un hallazgo sin ninguna foto no sobrevive al commit', async () => {
    const scheduled = await freshInspection();
    const accepted = await submissions.ingest(
      sessionFor(inspector.accountId, [SITE_A]),
      submissionFor(scheduled, SITE_A, versionV2, locationA),
    );

    const existing = one(await findingRows([SITE_A], accepted.id));

    // Se inserta a mano un hallazgo sin fotos: la restricción es diferida, así que el
    // INSERT pasa y lo que falla es el COMMIT. Es la única forma de probar que la
    // barrera no depende de que el servicio se acuerde.
    const error = await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO finding (site_id, origin, inspection_id, template_version_item_id, item_key,
                            location_id, description, reported_by, occurred_at)
       SELECT site_id, 'inspection', inspection_id, template_version_item_id, item_key,
              location_id, description, reported_by, occurred_at
         FROM finding WHERE id = $1`,
      [existing.id],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS003');
  });

  /**
   * La asimetría de D8: al derivar se acepta una ubicación desactivada, porque el
   * dispositivo llevaba el catálogo de cuando se preparó la inspección y rechazar el
   * envío convertiría una edición administrativa en una inspección perdida.
   */
  it('acepta una ubicación desactivada después de preparar el paquete de campo', async () => {
    const stale = await createLocation(db.app, SITE_A, 'stale-line', 'Stale line');
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, stale);

    await inScope(
      db.app,
      [SITE_A],
      'UPDATE location SET deactivated_at = now() WHERE id = $1',
      [stale],
    );

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    expect(one(await findingRows([SITE_A], accepted.id)).location_id).toBe(stale);
  });

  it('una ubicación de la otra planta viola la FK compuesta', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationB);

    const error = await submissions
      .ingest(sessionFor(inspector.accountId, [SITE_A]), payload)
      .catch((caught: unknown) => caught);

    // 23503: violación de clave foránea. No la comprueba el servicio: la comprueba el
    // motor, que es lo que hace que no dependa de que alguien se acuerde.
    expect(sqlstate(error)).toBe('23503');
  });
});

describe('la entrada manual', () => {
  function manual(overrides: Record<string, unknown> = {}) {
    const draftId = randomUUID();

    return {
      site_id: SITE_A,
      draft_finding_id: draftId,
      details: {
        description: 'Forklift near miss at the loading dock',
        location_id: locationA,
        photo_object_keys: [`${SITE_A}/manual/${draftId}/${randomUUID()}`],
      },
      occurred_at: '2026-08-10T13:00:00.000Z',
      ...overrides,
    };
  }

  it('un supervisor reporta un peligro, sin clasificación y sin item_key', async () => {
    const created = await findings.report(
      sessionFor(supervisor.accountId, [SITE_A], 'supervisor'),
      manual(),
    );

    expect(created.origin).toBe('manual');
    expect(created.inspection_id).toBeNull();
    expect(created.item_key).toBeNull();
    expect(created.template_version_item_id).toBeNull();
    expect(created).not.toHaveProperty('assessment');
  });

  it('queda fuera de la agrupación por item_key', async () => {
    const scheduled = await freshInspection();

    await submissions.ingest(
      sessionFor(inspector.accountId, [SITE_A]),
      submissionFor(scheduled, SITE_A, versionV2, locationA),
    );

    await findings.report(sessionFor(supervisor.accountId, [SITE_A], 'supervisor'), manual());

    const groups = await inScope<{ item_key: string; count: string }>(
      db.app,
      [SITE_A],
      `SELECT item_key, count(*)::text AS count FROM finding
        WHERE item_key IS NOT NULL GROUP BY item_key`,
    );

    // El manual no aparece en ningún grupo: es la consecuencia aceptada del riesgo F.
    expect(groups.every((group) => group.item_key !== null)).toBe(true);
  });

  it('rechaza una ubicación desactivada', async () => {
    const dead = await createLocation(db.app, SITE_A, 'dead-line', 'Dead line');

    await inScope(db.app, [SITE_A], 'UPDATE location SET deactivated_at = now() WHERE id = $1', [
      dead,
    ]);

    await expect(
      findings.report(
        sessionFor(supervisor.accountId, [SITE_A], 'supervisor'),
        manual({
          details: {
            description: 'Forklift near miss at the loading dock',
            location_id: dead,
            photo_object_keys: [`${SITE_A}/manual/${randomUUID()}/${randomUUID()}`],
          },
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_finding' } });
  });

  it('rechaza una foto que no es de este borrador', async () => {
    await expect(
      findings.report(
        sessionFor(supervisor.accountId, [SITE_A], 'supervisor'),
        manual({
          details: {
            description: 'Forklift near miss at the loading dock',
            location_id: locationA,
            photo_object_keys: [`${SITE_A}/manual/${randomUUID()}/${randomUUID()}`],
          },
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_finding' } });
  });

  it('un auditor externo no reporta nada', async () => {
    await expect(
      findings.report(sessionFor(auditor.accountId, [SITE_A], 'external_auditor'), manual()),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('un origen a medias no existe ni por SQL', async () => {
    const scheduled = await freshInspection();
    const accepted = await submissions.ingest(
      sessionFor(inspector.accountId, [SITE_A]),
      submissionFor(scheduled, SITE_A, versionV2, locationA),
    );

    const error = await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO finding (site_id, origin, inspection_id, location_id, description,
                            reported_by, occurred_at)
       VALUES ($1, 'inspection', $2, $3, 'Half derived finding row', $4, now())`,
      [SITE_A, accepted.id, locationA, inspector.accountId],
    ).catch((caught: unknown) => caught);

    // 23514: violación de CHECK. El de origen exactamente-uno.
    expect(sqlstate(error)).toBe('23514');
  });
});

describe('las rutas de hallazgos', () => {
  const registeredRoutes = () => {
    const prototype = FindingsController.prototype as unknown as Record<string, unknown>;

    return Object.getOwnPropertyNames(prototype).flatMap((name) => {
      const handler = prototype[name];

      if (typeof handler !== 'function') return [];

      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);

      return path === undefined || method === undefined
        ? []
        : [{ method, paths: Array.isArray(path) ? path : [path] }];
    });
  };

  it('conserva GET /findings/:id y no registra GET /findings/recurrence', () => {
    const routes = registeredRoutes();

    expect(
      routes.some(
        (route) => route.method === RequestMethod.GET && route.paths.includes('findings/:id'),
      ),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.method === RequestMethod.GET && route.paths.includes('findings/recurrence'),
      ),
    ).toBe(false);
  });

  it('ya no registra POST /findings/:id/risk-assessments', () => {
    const routes = registeredRoutes();

    expect(
      routes.some(
        (route) =>
          route.method === RequestMethod.POST &&
          route.paths.includes('findings/:id/risk-assessments'),
      ),
    ).toBe(false);
  });
});

describe('la retirada física de las marcas de recurrencia', () => {
  it('0038 elimina solo los objetos que sostenían la marca', async () => {
    const retired = await db.migrator.query<{ table_name: string | null; index_name: string | null; constraint_name: string | null }>(
      `SELECT to_regclass('public.finding_recurrence')::text AS table_name,
              to_regclass('public.finding_recurrence_idx')::text AS index_name,
              (SELECT conname FROM pg_constraint
                WHERE conrelid = 'finding'::regclass
                  AND conname = 'finding_id_item_key_uq') AS constraint_name`,
    );

    expect(retired.rows).toEqual([
      { table_name: null, index_name: null, constraint_name: null },
    ]);

    const survivingColumns = await db.migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'finding' AND column_name = 'item_key'`,
    );
    const survivingIndexes = await db.migrator.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [['finding_id_site_uq', 'finding_inspection_idx', 'finding_site_recorded_idx']],
    );

    expect(survivingColumns.rows).toEqual([{ column_name: 'item_key' }]);
    expect(survivingIndexes.rows.map((row) => row.indexname)).toEqual([
      'finding_id_site_uq',
      'finding_inspection_idx',
      'finding_site_recorded_idx',
    ]);
  });

  it('conserva RLS forzada y sus políticas en las tablas supervivientes', async () => {
    const tables = await db.migrator.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              count(p.policyname)::text AS policies
         FROM pg_class c
         LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
        WHERE c.oid = ANY($1::regclass[])
        GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
        ORDER BY c.relname`,
      [['audit_log', 'finding', 'finding_photo']],
    );

    expect(tables.rows.map(({ policies: _policies, ...table }) => table)).toEqual([
      { relname: 'audit_log', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'finding', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'finding_photo', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    expect(tables.rows.every((table) => Number(table.policies) > 0)).toBe(true);
  });
});

describe('el aislamiento por sitio', () => {
  it('un miembro del JHSC de una planta no ve los hallazgos de la otra', async () => {
    const inspectorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });
    const scheduledB = await scheduleInspection(db.app, {
      siteId: SITE_B,
      periodStart: nextPeriod(),
      templateId,
      templateVersionId: versionV2,
      inspectorId: inspectorB.accountId,
    });

    await submissions.ingest(
      sessionFor(inspectorB.accountId, [SITE_B]),
      submissionFor(scheduledB, SITE_B, versionV2, locationB),
    );

    const seenByA = await findings.list(sessionFor(inspector.accountId, [SITE_A]));

    expect(seenByA.every((finding) => finding.site_id === SITE_A)).toBe(true);

    const seenByCoordinator = await findings.list(
      sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator'),
    );

    expect(seenByCoordinator.some((finding) => finding.site_id === SITE_B)).toBe(true);
  });

  it('un hallazgo de la otra planta se ve igual que uno que no existe', async () => {
    const all = await findings.list(
      sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator'),
    );

    const fromB = all.find((finding) => finding.site_id === SITE_B);

    expect(fromB).toBeDefined();

    await expect(
      findings.get(sessionFor(inspector.accountId, [SITE_A]), fromB!.id),
    ).rejects.toMatchObject({ response: { code: 'finding_not_found' } });
  });
});

describe('la inmutabilidad', () => {
  async function anyFinding(): Promise<string> {
    const rows = await findingRows([SITE_A]);

    return one(rows.slice(0, 1)).id;
  }

  it('el rol de la aplicación no puede reescribir una descripción', async () => {
    const id = await anyFinding();

    const error = await inScope(
      db.app,
      [SITE_A],
      `UPDATE finding SET description = 'nothing to see' WHERE id = $1`,
      [id],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('42501');
  });

  it('el rol de migración lo frena el trigger, no el privilegio', async () => {
    const id = await anyFinding();

    // Con alcance declarado: `FORCE ROW LEVEL SECURITY` aplica también al dueño, así
    // que sin él la sentencia no tocaría ninguna fila y el trigger no diría nada.
    const error = await inScope(
      db.migrator,
      [SITE_A],
      `UPDATE finding SET description = 'nothing to see' WHERE id = $1`,
      [id],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS001');
  });

  it('ninguna de las tres tablas admite DELETE', async () => {
    const id = await anyFinding();

    for (const statement of [
      'DELETE FROM finding WHERE id = $1',
      'DELETE FROM finding_photo WHERE finding_id = $1',
    ]) {
      const error = await inScope(db.app, [SITE_A], statement, [id]).catch(
        (caught: unknown) => caught,
      );

      expect(sqlstate(error)).toBe('42501');
    }
  });

});

describe('la cadena de auditoría', () => {
  it('un envío con un negativo agrega su eslabón de finding.derived con el reloj del dispositivo', async () => {
    const before = (await events(SITE_A, 'finding.derived')).length;
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA);

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);
    const derived = await events(SITE_A, 'finding.derived');

    expect(derived).toHaveLength(before + 1);

    const last = derived[derived.length - 1];

    expect(last?.payload.item_key).toBe('fnd.guards');
    expect(last?.payload.inspection_id).toBe(accepted.id);
    expect(last?.occurred_at.toISOString()).toBe(new Date(payload.signed_at).toISOString());
  });

  it('un hallazgo con cuatro fotos agrega un solo eslabón', async () => {
    // El `before` se lee DESPUÉS de programar: abrir una inspección también deja su
    // propio eslabón (0008), y contarlo acá haría que este test midiera otra cosa.
    const scheduled = await freshInspection();
    const before = await chainLength(SITE_A);

    await submissions.ingest(
      sessionFor(inspector.accountId, [SITE_A]),
      submissionFor(scheduled, SITE_A, versionV2, locationA, {
        findings: { 'fnd.guards': details(SITE_A, scheduled, locationA, 4) },
      }),
    );

    // Dos eslabones: `inspection.submitted` y `finding.derived`. Ninguno por foto.
    expect(await chainLength(SITE_A)).toBe(before + 2);
  });

  it('un reenvío no agrega ningún eslabón', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, locationA);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    await submissions.ingest(session, payload);
    const after = await chainLength(SITE_A);

    await submissions.ingest(session, payload);
    await submissions.ingest(session, payload);

    expect(await chainLength(SITE_A)).toBe(after);
  });

  it('reportar a mano deja su propio eslabón, sin clasificación', async () => {
    const reportedBefore = (await events(SITE_A, 'finding.reported')).length;
    const draftId = randomUUID();

    await findings.report(
      sessionFor(supervisor.accountId, [SITE_A], 'supervisor'),
      {
        site_id: SITE_A,
        draft_finding_id: draftId,
        details: {
          description: 'Forklift near miss at the loading dock',
          location_id: locationA,
          photo_object_keys: [`${SITE_A}/manual/${draftId}/${randomUUID()}`],
        },
        occurred_at: '2026-08-10T13:00:00.000Z',
      },
    );

    const reported = await events(SITE_A, 'finding.reported');

    expect(reported).toHaveLength(reportedBefore + 1);
    expect(reported[reported.length - 1]?.payload.item_key).toBeNull();
  });
});

describe('la identidad del ítem a través de versiones', () => {
  it('el mismo ítem fallando en dos versiones cae en un solo grupo', async () => {
    const scheduledV1 = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: nextPeriod(),
      templateId,
      templateVersionId: versionV1,
      inspectorId: inspector.accountId,
    });

    await submissions.ingest(
      sessionFor(inspector.accountId, [SITE_A]),
      submissionFor(scheduledV1, SITE_A, versionV1, locationA),
    );

    const rows = await inScope<{ item_key: string; count: string; versions: string }>(
      db.app,
      [SITE_A],
      `SELECT item_key,
              count(*)::text AS count,
              count(DISTINCT template_version_item_id)::text AS versions
         FROM finding
        WHERE site_id = $1 AND item_key = 'fnd.guards'
        GROUP BY item_key`,
      [SITE_A],
    );

    const group = one(rows);

    // Un solo grupo, con filas de dos versiones publicadas distintas: la identidad
    // dual haciendo lo que existe para hacer (§4).
    expect(Number(group.count)).toBeGreaterThan(1);
    expect(Number(group.versions)).toBe(2);
  });
});
