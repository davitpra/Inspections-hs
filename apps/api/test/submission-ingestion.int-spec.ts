import { acceptedSubmissionSchema, type InspectionSubmission, type TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { SubmissionsService } from '../src/inspections/submissions.service';
import { createLocation, registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * ADR-008, COSTURA CRÍTICA 1 — La ingesta del envío.
 *
 * Lo que estos tests prueban no es que el endpoint guarde filas. Es que las cuatro
 * propiedades que hacen que un registro legal no se corrompa se cumplen incluso cuando
 * el dispositivo se porta mal:
 *
 *   1. Reenviar el mismo `client_submission_id` devuelve el registro existente.
 *   2. Un envío rechazado no deja NADA: ni fila, ni respuesta, ni eslabón en la cadena.
 *   3. Dos envíos concurrentes del mismo id producen un solo registro.
 *   4. Nadie envía por otro, y nadie ve la otra planta.
 *
 * Se le habla al servicio real y no a la base: la idempotencia vive en el `ON CONFLICT`
 * del servicio y en el único del motor, y probarla insertando a mano probaría el motor
 * solo.
 */

const SITE_A = '9d000000-0000-4000-8000-000000000001';
const SITE_B = '9d000000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: SchedulingStack;
let submissions: SubmissionsService;

let templateId: string;
let versionV1: string;
let versionV2: string;

/** La ubicación del hallazgo que `sub.guards` deriva. Lista cerrada (§6 pregunta 1). */
let locationA: string;

let inspector: { accountId: string };
let otherInspector: { accountId: string };
let inspectorB: { accountId: string };

/**
 * Los ítems del documento. Cuarenta y uno en total: cuarenta para poder afirmar "39
 * respuestas válidas no se escriben cuando falta la que sobra", más el condicional,
 * la foto y la firma.
 */
const FILLER_COUNT = 38;

const fillerKeys = Array.from({ length: FILLER_COUNT }, (_, i) => `sub.item-${i + 1}`);

const ITEM_KEYS = [
  ...fillerKeys,
  'sub.guards',
  'sub.spill-present',
  'sub.spill-cleanup',
  'sub.photo',
  'sub.sign',
];

function document(): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          ...fillerKeys.map((item_key, index) => ({
            item_key,
            prompt: `Filler ${index + 1}`,
            position: index + 1,
            required: true,
            response_type: 'yes_no' as const,
          })),
          {
            item_key: 'sub.guards',
            prompt: 'Machine guards in place',
            position: FILLER_COUNT + 1,
            required: true,
            response_type: 'yes_no' as const,
          },
          {
            item_key: 'sub.spill-present',
            prompt: 'Spill present',
            position: FILLER_COUNT + 2,
            required: true,
            response_type: 'yes_no_na' as const,
          },
          {
            // Solo se pregunta si hubo derrame: es el ítem con el que se prueba que una
            // respuesta a algo que el inspector nunca vio se rechaza.
            item_key: 'sub.spill-cleanup',
            prompt: 'Spill cleaned up',
            position: FILLER_COUNT + 3,
            required: true,
            response_type: 'yes_no' as const,
            visible_when: {
              item_key: 'sub.spill-present',
              operator: 'equals' as const,
              value: 'yes',
            },
          },
          {
            item_key: 'sub.photo',
            prompt: 'Photo of the dock',
            position: FILLER_COUNT + 4,
            required: true,
            response_type: 'photo' as const,
            min_count: 1,
            max_count: 3,
          },
          {
            item_key: 'sub.sign',
            prompt: 'Inspector signature',
            position: FILLER_COUNT + 5,
            required: true,
            response_type: 'signature' as const,
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

/** Una object key con el prefijo que `uploads` deriva para esta inspección. */
const keyFor = (siteId: string, inspectionId: string, name: string = randomUUID()) =>
  `${siteId}/${inspectionId}/${name}`;

/**
 * Un envío completo y válido. Los tests lo desarman: es más honesto partir de algo que
 * el servidor acepta y romperle una cosa que armar el caso roto desde cero, porque así
 * el caso roto no puede estar fallando por otra razón.
 */
function submissionFor(
  scheduledInspectionId: string,
  siteId: string,
  templateVersionId: string,
  overrides: Partial<InspectionSubmission> = {},
): InspectionSubmission {
  const answers: Record<string, unknown> = {};

  for (const key of fillerKeys) answers[key] = true;

  answers['sub.guards'] = false;
  answers['sub.spill-present'] = 'na';
  answers['sub.sign'] = {
    object_key: keyFor(siteId, scheduledInspectionId, 'signature'),
    signed_at: '2026-08-03T14:20:00-04:00',
  };

  return {
    client_submission_id: randomUUID(),
    scheduled_inspection_id: scheduledInspectionId,
    template_version_id: templateVersionId,
    answers: answers as InspectionSubmission['answers'],
    // La foto va SOLO acá y no en `answers`: es exactamente lo que el dispositivo
    // manda, y sin la fusión del servicio `sub.photo` saldría `required_missing`.
    photos: { 'sub.photo': [keyFor(siteId, scheduledInspectionId)] },
    // `sub.guards` viene en `false`, así que el envío TIENE que traer su hallazgo
    // (etapa 4). Sus fotos van acá y no en `photos`: ahí chocarían con la respuesta
    // booleana del mismo ítem.
    findings: {
      'sub.guards': {
        description: 'Guard missing on the infeed of the packaging line',
        location_id: locationA,
        photo_object_keys: [keyFor(siteId, scheduledInspectionId, 'finding')],
      },
    },
    signed_at: '2026-08-03T14:20:00-04:00',
    ...overrides,
  };
}

/** Una inspección programada nueva, para no compartir estado entre tests. */
async function freshInspection(
  siteId = SITE_A,
  inspectorId: string | null = null,
  templateVersionId = versionV2,
): Promise<string> {
  return scheduleInspection(db.app, {
    siteId,
    // Un período distinto por inspección: el único parcial de 0008 prohíbe dos
    // abiertas del mismo `(sitio, plantilla, período)`.
    periodStart: nextPeriod(),
    templateId,
    templateVersionId,
    inspectorId: inspectorId ?? inspector.accountId,
  });
}

let periodCursor = 0;

function nextPeriod(): string {
  periodCursor += 1;
  const month = ((periodCursor - 1) % 12) + 1;
  const year = 2030 + Math.floor((periodCursor - 1) / 12);

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

async function inspectionRows(clientSubmissionId: string) {
  return inScope<{ id: string; site_id: string; answer_count: number; submitted_by: string; signed_at: Date; received_at: Date }>(
    db.app,
    [SITE_A, SITE_B],
    `SELECT id, site_id, answer_count, submitted_by, signed_at, received_at
       FROM inspection WHERE client_submission_id = $1`,
    [clientSubmissionId],
  );
}

async function answerRows(inspectionId: string) {
  return inScope<{ item_key: string; template_version_item_id: string; value: unknown }>(
    db.app,
    [SITE_A, SITE_B],
    `SELECT item_key, template_version_item_id, value
       FROM inspection_answer WHERE inspection_id = $1 ORDER BY item_key`,
    [inspectionId],
  );
}

async function submittedEvents(siteId: string) {
  return inScope<{ seq: string; payload: Record<string, unknown>; occurred_at: Date; recorded_at: Date }>(
    db.app,
    [siteId],
    `SELECT seq, payload, occurred_at, recorded_at
       FROM audit_log WHERE site_id = $1 AND event_type = 'inspection.submitted'
      ORDER BY seq`,
    [siteId],
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

  await registerSite(db.migrator, SITE_A, 'ingest-a');
  await registerSite(db.migrator, SITE_B, 'ingest-b');

  locationA = await createLocation(db.app, SITE_A, 'dock-1', 'Dock 1');

  templateId = await createTemplate(db.migrator, 'ingest-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ITEM_KEYS);

  versionV1 = await publishVersion(db.migrator, templateId, 1, document());
  versionV2 = await publishVersion(db.migrator, templateId, 2, document());

  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  otherInspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  inspectorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });
}, 120_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('aceptación', () => {
  it('crea la inspección, sus respuestas como filas, y devuelve created: true', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    // La respuesta cumple el contrato compartido con el dispositivo, letra por letra.
    expect(acceptedSubmissionSchema.parse(accepted)).toEqual(accepted);
    expect(accepted.created).toBe(true);
    expect(accepted.scheduled_inspection_id).toBe(scheduled);
    expect(accepted.template_version_id).toBe(versionV2);
    expect(accepted.submitted_by).toBe(inspector.accountId);

    const row = one(await inspectionRows(payload.client_submission_id));

    // 41 respuestas: 38 de relleno + guards + spill-present + photo + sign, menos
    // spill-cleanup, que estas mismas respuestas dejan oculto.
    expect(row.answer_count).toBe(FILLER_COUNT + 4);

    const answers = await answerRows(accepted.id);

    expect(answers).toHaveLength(FILLER_COUNT + 4);
    expect(answers.map((a) => a.item_key)).not.toContain('sub.spill-cleanup');

    // Cada fila lleva la identidad dual: el concepto y la fila publicada.
    for (const answer of answers) {
      expect(answer.template_version_item_id).toEqual(expect.any(String));
    }

    // La foto quedó como respuesta de su ítem, con la object key y no con bytes.
    const photo = answers.find((a) => a.item_key === 'sub.photo');
    expect(photo?.value).toEqual(payload.photos['sub.photo']);
  });

  it('guarda el reloj del dispositivo y el del servidor por separado', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    const row = one(await inspectionRows(payload.client_submission_id));

    expect(row.signed_at.toISOString()).toBe(new Date(payload.signed_at).toISOString());
    // Riesgo C de §5: el servidor no adopta el reloj del teléfono.
    expect(row.received_at.getTime()).toBeGreaterThan(row.signed_at.getTime());
  });

  /**
   * El cierre, visible desde la lista. Es lo que la pantalla del inspector fecha, y por eso
   * importa CUÁL de los dos relojes viaja: `signed_at`, el del recorrido, no `received_at`.
   * Los dos se separan por todo lo que el dispositivo haya estado sin señal, y el mes es lo
   * que identifica la obligación ante el regulador.
   */
  it('el período listado queda fechado por la firma, no por la recepción', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const before = one(
      (await stack.inspections.listScheduled(session)).filter((item) => item.id === scheduled),
    );

    expect(before.status).not.toBe('completed');
    expect(before.inspection_id).toBeNull();
    expect(before.completed_at).toBeNull();

    const accepted = await submissions.ingest(session, payload);
    const row = one(await inspectionRows(payload.client_submission_id));

    const after = one(
      (await stack.inspections.listScheduled(session)).filter((item) => item.id === scheduled),
    );

    expect(after.status).toBe('completed');
    expect(after.inspection_id).toBe(accepted.id);
    expect(after.completed_at).toBe(row.signed_at.toISOString());
    expect(after.completed_at).not.toBe(row.received_at.toISOString());
  });

  it('acepta un ítem de foto satisfecho SOLO por photos', async () => {
    // Es el caso normal del dispositivo y por eso es el que más barato se rompe: si
    // alguien quita la fusión, este test es el único que lo dice.
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    expect(payload.answers).not.toHaveProperty('sub.photo');

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    expect(accepted.created).toBe(true);
  });
});

describe('idempotencia', () => {
  it('reenviar el mismo client_submission_id devuelve el registro existente', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const first = await submissions.ingest(session, payload);

    const replays = [
      await submissions.ingest(session, payload),
      await submissions.ingest(session, payload),
      await submissions.ingest(session, payload),
    ];

    for (const replay of replays) {
      // Misma forma, mismo registro, y `created` es lo ÚNICO que cambia. No un 409.
      expect(replay).toEqual({ ...first, created: false });
    }

    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(1);
    expect(await answerRows(first.id)).toHaveLength(FILLER_COUNT + 4);
  });

  it('el reenvío no agrega un segundo eslabón a la cadena', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    await submissions.ingest(session, payload);
    const afterFirst = await chainLength(SITE_A);

    await submissions.ingest(session, payload);
    await submissions.ingest(session, payload);

    expect(await chainLength(SITE_A)).toBe(afterFirst);

    const events = await submittedEvents(SITE_A);
    const mine = events.filter(
      (event) => event.payload.client_submission_id === payload.client_submission_id,
    );

    expect(mine).toHaveLength(1);
  });

  it('dos envíos concurrentes del mismo id producen un solo registro', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const session = sessionFor(inspector.accountId, [SITE_A]);

    // El outbox puede robar su propio lock y mandar el mismo id dos veces a la vez
    // (`offline-inspection-capture`, LOCK_TIMEOUT_MS). Esto es ese escenario.
    const [a, b] = await Promise.all([
      submissions.ingest(session, payload),
      submissions.ingest(session, payload),
    ]);

    expect(a.id).toBe(b.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(1);
    expect(await answerRows(a.id)).toHaveLength(FILLER_COUNT + 4);
  });

  it('un segundo envío con otro id para la misma inspección es already_submitted', async () => {
    const scheduled = await freshInspection();
    const session = sessionFor(inspector.accountId, [SITE_A]);

    const first = await submissions.ingest(
      session,
      submissionFor(scheduled, SITE_A, versionV2),
    );

    // Otro `client_submission_id`: no es un reintento, es otro borrador. Un dueño, un
    // dispositivo, un firmante.
    await expect(
      submissions.ingest(session, submissionFor(scheduled, SITE_A, versionV2)),
    ).rejects.toMatchObject({ response: { code: 'already_submitted' } });

    const rows = await inScope<{ id: string }>(
      db.app,
      [SITE_A],
      'SELECT id FROM inspection WHERE scheduled_inspection_id = $1',
      [scheduled],
    );

    expect(rows).toHaveLength(1);
    expect(one(rows).id).toBe(first.id);
  });
});

describe('todo o nada', () => {
  it('un required faltante no deja ninguna de las 39 respuestas válidas', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const before = await chainLength(SITE_A);

    delete (payload.answers as Record<string, unknown>)['sub.guards'];

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        // Dos violaciones y no una: al borrar la respuesta, `sub.guards` deja de estar
        // contestado —`required_missing`— y sus detalles de hallazgo pasan a sobrar
        // —`unexpected_finding`—. Las dos fuentes viajan en la misma lista.
        violations: [
          { item_key: 'sub.guards', code: 'required_missing' },
          { item_key: 'sub.guards', code: 'unexpected_finding' },
        ],
      },
    });

    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(0);

    const answers = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count
         FROM inspection_answer a
         JOIN inspection i ON i.id = a.inspection_id
        WHERE i.scheduled_inspection_id = $1`,
      [scheduled],
    );

    expect(Number(one(answers).count)).toBe(0);
    expect(await chainLength(SITE_A)).toBe(before);
  });

  it('devuelve TODAS las violaciones, no la primera', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const answers = payload.answers as Record<string, unknown>;

    delete answers['sub.guards'];
    answers['sub.item-1'] = 'no es un booleano';
    answers['sub.item-2'] = 3;
    answers['sub.item-3'] = ['tampoco'];

    const failure: { violations: unknown[] } = await submissions
      .ingest(sessionFor(inspector.accountId, [SITE_A]), payload)
      .then(
        () => ({ violations: [] as unknown[] }),
        (error: { response: { violations: unknown[] } }) => error.response,
      );

    // Cinco: las cuatro de siempre más el `unexpected_finding` del hallazgo que quedó
    // huérfano al borrar la respuesta negativa que lo implicaba.
    expect(failure.violations).toHaveLength(5);
  });

  it('rechaza una respuesta de una item_key que el documento no tiene', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    (payload.answers as Record<string, unknown>)['sub.item-1'] = true;
    (payload.answers as Record<string, unknown>)['sub.ghost'] = true;

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        violations: [{ item_key: 'sub.ghost', code: 'unknown_item' }],
      },
    });
  });

  it('rechaza una respuesta a un ítem que estas mismas respuestas ocultan', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    // `spill-present` es 'na', así que `spill-cleanup` está oculto. Aceptar su
    // respuesta dejaría en el registro inmutable la contestación de una pregunta que
    // el inspector nunca vio.
    (payload.answers as Record<string, unknown>)['sub.spill-cleanup'] = true;

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        violations: [{ item_key: 'sub.spill-cleanup', code: 'answer_for_hidden_item' }],
      },
    });
  });

  it('acepta el ítem condicional cuando la condición lo hace visible', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);
    const answers = payload.answers as Record<string, unknown>;

    answers['sub.spill-present'] = 'yes';
    answers['sub.spill-cleanup'] = true;

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    const rows = await answerRows(accepted.id);

    expect(rows.map((row) => row.item_key)).toContain('sub.spill-cleanup');
    expect(one(await inspectionRows(payload.client_submission_id)).answer_count).toBe(
      FILLER_COUNT + 5,
    );
  });
});

describe('la versión congelada', () => {
  it('rechaza un envío armado contra otra versión publicada de la misma plantilla', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV1);

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });

    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(0);
  });

  it('el motor rechaza la discrepancia aunque el insert no pase por el servicio', async () => {
    const scheduled = await freshInspection();

    // La segunda barrera: si el servicio se equivocara, esto sigue fallando.
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO inspection (site_id, scheduled_inspection_id, template_version_id,
                                 client_submission_id, submitted_by, signed_at, answer_count)
         VALUES ($1, $2, $3, gen_random_uuid(), $4, now(), 0)`,
        [SITE_A, scheduled, versionV1, inspector.accountId],
      ),
    ).rejects.toMatchObject({ code: 'HS002' });
  });

  it('rechaza el envío de una inspección cancelada', async () => {
    const scheduled = await freshInspection();

    await inScope(
      db.app,
      [SITE_A],
      `UPDATE scheduled_inspection
          SET cancelled_at = now(), cancellation_reason = 'planta cerrada'
        WHERE id = $1`,
      [scheduled],
    );

    const payload = submissionFor(scheduled, SITE_A, versionV2);

    // `invalid_submission` y NO `inspection_not_found`: el inspector hizo el trabajo y
    // alguien tiene que mirarlo. El outbox detiene la entrada y deja el borrador
    // legible en el dispositivo.
    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });
  });
});

describe('object keys', () => {
  it('rechaza una key con el prefijo de otra inspección', async () => {
    const scheduled = await freshInspection();
    const other = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2, {
      photos: { 'sub.photo': [keyFor(SITE_A, other)] },
    });

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });

    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(0);
  });

  it('rechaza la object key de una firma de otra planta', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    (payload.answers as Record<string, unknown>)['sub.sign'] = {
      object_key: keyFor(SITE_B, scheduled, 'signature'),
      signed_at: '2026-08-03T14:20:00-04:00',
    };

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });
  });

  it('rechaza la misma item_key contestada en answers y en photos', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    (payload.answers as Record<string, unknown>)['sub.photo'] = [
      keyFor(SITE_A, scheduled, 'desde-answers'),
    ];

    await expect(
      submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'invalid_submission' } });
  });
});

describe('alcance y autoría', () => {
  it('otro inspector de la misma planta no puede enviar', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    await expect(
      submissions.ingest(sessionFor(otherInspector.accountId, [SITE_A]), payload),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });

    expect(await inspectionRows(payload.client_submission_id)).toHaveLength(0);
  });

  it('una inspección sin inspector asignado no acepta nada', async () => {
    const scheduled = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: nextPeriod(),
      templateId,
      templateVersionId: versionV2,
      inspectorId: null,
    });

    await expect(
      submissions.ingest(
        sessionFor(inspector.accountId, [SITE_A]),
        submissionFor(scheduled, SITE_A, versionV2),
      ),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('la inspección de la otra planta es indistinguible de una que no existe', async () => {
    const scheduled = await scheduleInspection(db.app, {
      siteId: SITE_B,
      periodStart: nextPeriod(),
      templateId,
      templateVersionId: versionV2,
      inspectorId: inspectorB.accountId,
    });

    const payload = submissionFor(scheduled, SITE_B, versionV2);

    const failure = await submissions
      .ingest(sessionFor(inspector.accountId, [SITE_A]), payload)
      .then(
        () => ({ code: 'accepted', message: '' }),
        (error: { response: { code: string; message: string } }) => error.response,
      );

    expect(failure.code).toBe('inspection_not_found');

    // El cuerpo no dice nada de esa inspección: ni su planta, ni su período, ni su
    // plantilla. Si lo dijera, el endpoint sería un oráculo de la otra planta.
    const body = JSON.stringify(failure);

    expect(body).not.toContain(SITE_B);
    expect(body).not.toContain(scheduled);
    expect(body).not.toContain(versionV2);
  });

  it('una inspección que no existe responde igual', async () => {
    const missing = '9d000000-0000-4000-8000-0000000000ff';

    await expect(
      submissions.ingest(
        sessionFor(inspector.accountId, [SITE_A]),
        submissionFor(missing, SITE_A, versionV2),
      ),
    ).rejects.toMatchObject({ response: { code: 'inspection_not_found' } });
  });

  it('el firmante sale de la sesión y no del cuerpo', async () => {
    const scheduled = await freshInspection();
    const payload = submissionFor(scheduled, SITE_A, versionV2);

    // El contrato es `strictObject`: no hay campo del cuerpo que pueda declarar un
    // actor. Se afirma acá para que el día que alguien agregue uno, esto falle.
    expect(Object.keys(payload)).toEqual([
      'client_submission_id',
      'scheduled_inspection_id',
      'template_version_id',
      'answers',
      'photos',
      'findings',
      'signed_at',
    ]);

    const accepted = await submissions.ingest(sessionFor(inspector.accountId, [SITE_A]), payload);

    expect(accepted.submitted_by).toBe(inspector.accountId);
  });
});
