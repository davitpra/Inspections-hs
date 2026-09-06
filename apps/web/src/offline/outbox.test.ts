import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_DOCUMENT, fail, fakeSessionClient, ok, type FakeCall } from '../test/fixtures';
import { freshDatabase, reopen } from '../test/database';
import type { OfflineDatabase } from './db';
import { openDraft, saveAnswer, saveFinding, signDraft } from './drafts';
import { capturePhoto } from './photos';
import {
  BACKOFF_CAP_MS,
  backoffMs,
  deviceWork,
  enqueue,
  isQueued,
  outboxFor,
  runOutbox,
  sendEntry,
  type OutboxDeps,
} from './outbox';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = 'account-a';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

function draftInput() {
  return {
    scheduled_inspection_id: INSPECTION_ID,
    account_id: ACCOUNT,
    site_id: 'site-1',
    template_version_id: VERSION_ID,
  };
}

/** El servidor que acepta el envío y devuelve el registro creado. */
function acceptingServer(overrides: { created?: boolean } = {}) {
  return fakeSessionClient({
    respond: (path, init) => {
      if (path === '/uploads/presign') {
        return ok({
          url: 'https://bucket.example.com/put?X-Amz-Signature=abc',
          object_key: `site/inspection/${crypto.randomUUID()}`,
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        });
      }

      if (path === '/inspection-submissions') {
        const body = JSON.parse(String(init.body)) as { client_submission_id: string };

        return ok({
          id: '33333333-3333-4333-8333-333333333333',
          client_submission_id: body.client_submission_id,
          scheduled_inspection_id: INSPECTION_ID,
          template_version_id: VERSION_ID,
          submitted_at: '2026-08-01T12:00:00.000Z',
          submitted_by: '44444444-4444-4444-8444-444444444444',
          created: overrides.created ?? true,
        });
      }

      throw new Error(`path inesperado: ${path}`);
    },
  });
}

const bucketOk = vi.fn(async () => new Response(null, { status: 200 }));

/** Un borrador completo, firmado y encolado. */
async function readyDraft(database: OfflineDatabase, photos = 0): Promise<string> {
  const draft = await openDraft(draftInput(), database);

  await saveAnswer(
    draft.client_submission_id,
    'guarding.installed',
    true,
    TEST_DOCUMENT,
    database,
  );

  for (let index = 0; index < photos; index += 1) {
    await capturePhoto(
      {
        client_submission_id: draft.client_submission_id,
        item_key: 'guarding.photo',
        blob: new Blob([`foto-${index}`], { type: 'image/jpeg' }),
      },
      database,
    );
  }

  await signDraft(draft.client_submission_id, database);
  await enqueue(draft.client_submission_id, database);

  return draft.client_submission_id;
}

function submissions(calls: FakeCall[]): { client_submission_id: string }[] {
  return calls
    .filter((call) => call.path === '/inspection-submissions')
    .map((call) => JSON.parse(String(call.init.body)) as { client_submission_id: string });
}

describe('enqueue', () => {
  it('crea una sola entrada por inspección', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    await enqueue(id, database);
    await enqueue(id, database);

    expect(await database.outbox.count()).toBe(1);
  });
});

describe('sendEntry', () => {
  it('envía una vez y borra la entrada solo después de que el servidor la aceptó', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    const client = acceptingServer();

    const outcome = await sendEntry(id, { database, client, put: bucketOk });

    expect(outcome).toEqual({ kind: 'accepted' });
    expect(submissions(client.calls)).toHaveLength(1);
    expect(await database.outbox.get(id)).toBeUndefined();
    expect((await database.drafts.get(id))?.status).toBe('accepted');
  });

  /** ADR-001 — el payload lleva object keys y NUNCA bytes. */
  it('el payload referencia las fotos por object key y no contiene imágenes', async () => {
    database = freshDatabase();
    const id = await readyDraft(database, 2);
    const client = acceptingServer();

    await sendEntry(id, { database, client, put: bucketOk });

    const [payload] = submissions(client.calls) as unknown as [
      { photos: Record<string, string[]> },
    ];

    expect(payload.photos['guarding.photo']).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain('foto-0');
  });

  /** Spec: "A submission waits for its photos". */
  it('no envía mientras una foto esté sin subir, e intenta las subidas pendientes', async () => {
    database = freshDatabase();
    const id = await readyDraft(database, 3);
    const client = acceptingServer();

    const failingBucket = vi.fn(async (_url: string, blob: Blob) =>
      (await blob.text()) === 'foto-1'
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 200 }),
    );

    const outcome = await sendEntry(id, { database, client, put: failingBucket });

    expect(outcome).toEqual({ kind: 'waiting_for_photos', pending: 1 });
    expect(submissions(client.calls)).toHaveLength(0);
    // Las otras dos SÍ se intentaron y subieron.
    expect(failingBucket).toHaveBeenCalledTimes(3);
    expect(await database.outbox.get(id)).toBeDefined();

    // Con el bucket sano, la corrida siguiente sube la que faltaba y envía.
    const second = await sendEntry(id, { database, client, put: bucketOk });
    expect(second).toEqual({ kind: 'accepted' });
  });

  /** Spec: "A concurrent run does not double-send". D3 — el lock es una fila. */
  it('dos corridas concurrentes de la misma entrada producen un solo envío', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    const client = acceptingServer();
    const deps: OutboxDeps = { database, client, put: bucketOk };

    const [first, second] = await Promise.all([sendEntry(id, deps), sendEntry(id, deps)]);

    expect(submissions(client.calls)).toHaveLength(1);
    expect([first.kind, second.kind].sort()).toEqual(['accepted', 'skipped']);
  });

  /** Spec: "An expired session does not lose the submission". */
  it('una sesión que no se puede renovar deja la entrada en cola y pide login', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const expired = fakeSessionClient({
      freshSession: false,
      respond: () => fail('session_ended', 'la sesión terminó'),
    });

    const outcome = await sendEntry(id, { database, client: expired, put: bucketOk });

    expect(outcome).toEqual({ kind: 'sign_in_required' });
    // LA ENTRADA SIGUE ACÁ. Ningún código de error significa "descartá".
    const entry = await database.outbox.get(id);
    expect(entry).toBeDefined();
    expect(entry?.state).toBe('queued');
    expect(entry?.attempts).toBe(0);
    expect((await database.drafts.get(id))?.status).toBe('signed');
  });

  it('un 401 durante el envío tampoco cuenta como intento ni descarta nada', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    // `freshSession: false` es lo que hace de esto un 401 DE VERDAD: la sesión ya no se
    // puede renovar. Sin eso sería un error de servidor mal etiquetado, que es otro caso
    // y se prueba abajo.
    const client = fakeSessionClient({
      freshSession: false,
      respond: (path) =>
        path === '/inspection-submissions'
          ? fail('session_ended', 'la sesión terminó a mitad del envío')
          : ok({}),
    });

    expect(await sendEntry(id, { database, client, put: bucketOk })).toEqual({
      kind: 'sign_in_required',
    });
    expect((await database.outbox.get(id))?.attempts).toBe(0);
  });

  /**
   * REGRESIÓN. Si el servidor etiqueta mal una respuesta como `session_ended`, creerle al
   * pie de la letra haría que el envío no contara como intento ni programara retroceso, y
   * cada disparador reintentara al instante: el martilleo que D8 existe para evitar.
   *
   * Se vio de verdad, con `POST /inspection-submissions` sin implementar.
   */
  it('un error de servidor sin código tipado retrocede en vez de martillar', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    // La sesión SIGUE VIVA: el servidor prestó una etiqueta incorrecta al 404.
    const client = fakeSessionClient({
      freshSession: true,
      respond: (path) =>
        path === '/inspection-submissions'
          ? fail('session_ended', 'Cannot POST /inspection-submissions')
          : ok({}),
    });

    const outcome = await sendEntry(id, {
      database,
      client,
      put: bucketOk,
      now: () => 0,
      jitter: () => 0,
    });

    expect(outcome.kind).toBe('retry');

    const entry = await database.outbox.get(id);
    expect(entry?.attempts).toBe(1);
    expect(entry?.next_attempt_at).toBe(1_000);
    // Y la entrada sigue en cola: nada se descarta por un error que no supimos leer.
    expect(entry?.state).toBe('queued');
  });

  /** Spec: "A rejected submission is kept and surfaced, not dropped". */
  it('un rechazo de validación detiene la entrada y conserva el borrador legible', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const rejecting = fakeSessionClient({
      respond: (path) =>
        path === '/inspection-submissions'
          ? fail('validation_failed', 'guarding.reason: required_missing')
          : ok({}),
    });

    const outcome = await sendEntry(id, { database, client: rejecting, put: bucketOk });

    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'guarding.reason: required_missing',
    });

    const entry = await database.outbox.get(id);
    expect(entry?.state).toBe('rejected');
    expect(entry?.last_error).toContain('required_missing');

    // El borrador y sus respuestas siguen legibles en el dispositivo.
    expect(await database.answers.where('client_submission_id').equals(id).count()).toBe(1);

    // Y no se vuelve a intentar.
    const again = await sendEntry(id, { database, client: rejecting, put: bucketOk });
    expect(again).toEqual({ kind: 'skipped' });
  });

  /**
   * El cuerpo que no es del contrato tampoco se reintenta.
   *
   * `ZodExceptionFilter` de la API lo devuelve como `400 invalid_request`. Antes de ese
   * filtro salía como `500` sin código tipado y la entrada quedaba reintentando con
   * retroceso un payload que el servidor nunca iba a aceptar. Este test es esa regresión.
   */
  it('un cuerpo que no cumple el contrato detiene la entrada, no la reintenta', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const rejecting = fakeSessionClient({
      respond: (path) =>
        path === '/inspection-submissions'
          ? fail('invalid_request', 'findings.guarding.installed.description: too_small')
          : ok({}),
    });

    const outcome = await sendEntry(id, { database, client: rejecting, put: bucketOk });

    expect(outcome.kind).toBe('rejected');

    const entry = await database.outbox.get(id);
    expect(entry?.state).toBe('rejected');
    expect(entry?.last_error).toContain('too_small');

    // Y no se vuelve a intentar.
    expect(await sendEntry(id, { database, client: rejecting, put: bucketOk })).toEqual({
      kind: 'skipped',
    });
  });

  /** Spec: "Repeated failures back off rather than hammer the network". */
  it('los reintentos crecen y guardan attempts y last_error', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    let clock = 1_000_000;

    const flaky = fakeSessionClient({
      respond: (path) =>
        path === '/inspection-submissions' ? fail('server_error', 'el servidor falló') : ok({}),
    });

    const deps: OutboxDeps = {
      database,
      client: flaky,
      put: bucketOk,
      now: () => clock,
      jitter: () => 0,
    };

    const intervals: number[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await sendEntry(id, deps);
      expect(outcome.kind).toBe('retry');

      const entry = await database.outbox.get(id);
      intervals.push(entry!.next_attempt_at - clock);
      clock = entry!.next_attempt_at;
    }

    expect(intervals).toEqual([1_000, 2_000, 4_000]);

    const entry = await database.outbox.get(id);
    expect(entry?.attempts).toBe(3);
    expect(entry?.last_error).toBe('el servidor falló');
    expect(entry?.state).toBe('queued');
  });

  it('un fallo de red reintenta en vez de rechazar', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const offline = fakeSessionClient({
      respond: (path) => (path === '/inspection-submissions' ? null : ok({})),
    });

    const outcome = await sendEntry(id, { database, client: offline, put: bucketOk });

    expect(outcome.kind).toBe('retry');
    expect((await database.outbox.get(id))?.state).toBe('queued');
  });

  it('no reintenta antes de que llegue su turno', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    await database.outbox.update(id, { next_attempt_at: 5_000 });

    expect(await sendEntry(id, { database, now: () => 1_000 })).toEqual({ kind: 'skipped' });
  });

  /**
   * D8 — `409` como éxito: un reenvío del mismo `client_submission_id` devuelve el
   * registro existente. Que el registro exista es todo lo que el dispositivo quería.
   */
  it('un conflicto se trata como aceptación', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const conflicting = fakeSessionClient({
      respond: (path) =>
        path === '/inspection-submissions' ? fail('conflict', 'ya existe') : ok({}),
    });

    expect(await sendEntry(id, { database, client: conflicting, put: bucketOk })).toEqual({
      kind: 'accepted',
    });
    expect(await database.outbox.get(id)).toBeUndefined();
  });

  /**
   * Spec: "A retry reuses the same identifier". El doble del contrato verifica que el
   * segundo intento manda EXACTAMENTE el mismo `client_submission_id` que el primero,
   * incluso a través de cerrar y reabrir la aplicación.
   */
  it('el segundo intento manda el mismo client_submission_id, aun tras reiniciar', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const flaky = fakeSessionClient({
      respond: (path) =>
        path === '/inspection-submissions' ? fail('server_error', 'falló') : ok({}),
    });

    await sendEntry(id, { database, client: flaky, put: bucketOk, now: () => 0, jitter: () => 0 });

    database = await reopen(database);

    const accepting = acceptingServer();
    await sendEntry(id, {
      database,
      client: accepting,
      put: bucketOk,
      now: () => 10_000_000,
    });

    const firstAttempt = submissions(flaky.calls)[0];
    const secondAttempt = submissions(accepting.calls)[0];

    expect(firstAttempt?.client_submission_id).toBe(id);
    expect(secondAttempt?.client_submission_id).toBe(id);
  });
});

describe('el bloque de hallazgos del payload', () => {
  /** Requisitos §3 R2: la respuesta negativa viaja con su descripción, ubicación y foto. */
  it('viaja con una entrada por respuesta negativa', async () => {
    database = freshDatabase();
    const draft = await openDraft(draftInput(), database);
    const id = draft.client_submission_id;

    await saveAnswer(id, 'guarding.installed', false, TEST_DOCUMENT, database);
    await saveFinding(
      id,
      'guarding.installed',
      {
        description: 'Guard missing on the infeed of line 3',
        location_id: '44444444-4444-4444-8444-444444444444',
      },
      database,
    );
    await capturePhoto(
      {
        client_submission_id: id,
        item_key: 'guarding.installed',
        blob: new Blob(['foto-hallazgo'], { type: 'image/jpeg' }),
        kind: 'finding',
      },
      database,
    );

    await signDraft(id, database);
    await enqueue(id, database);

    const client = acceptingServer();
    await sendEntry(id, { database, client, put: bucketOk });

    const [payload] = submissions(client.calls) as unknown as [
      {
        photos: Record<string, string[]>;
        findings: Record<
          string,
          { description: string; location_id: string; photo_object_keys: string[] }
        >;
      },
    ];

    expect(payload.findings['guarding.installed']).toMatchObject({
      description: 'Guard missing on the infeed of line 3',
      location_id: '44444444-4444-4444-8444-444444444444',
    });
    expect(payload.findings['guarding.installed']?.photo_object_keys).toHaveLength(1);

    // LA SEPARACIÓN QUE IMPORTA: la foto del hallazgo NO cae en `photos`, donde
    // chocaría con la respuesta booleana del mismo ítem y el servidor rechazaría el
    // envío por colisión.
    expect(payload.photos['guarding.installed']).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('foto-hallazgo');
  });

  it('un envío sin negativos lleva el bloque vacío', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    const client = acceptingServer();

    await sendEntry(id, { database, client, put: bucketOk });

    const [payload] = submissions(client.calls) as unknown as [{ findings: Record<string, unknown> }];

    expect(payload.findings).toEqual({});
  });
});

describe('runOutbox', () => {
  it('recorre las entradas con turno y deja las demás', async () => {
    database = freshDatabase();
    await readyDraft(database);
    const client = acceptingServer();

    const outcomes = await runOutbox({ database, client, put: bucketOk, accountId: ACCOUNT });

    expect(outcomes).toEqual([{ kind: 'accepted' }]);
    expect(await database.outbox.count()).toBe(0);
  });

  /**
   * El dispositivo es compartido. Mandar la entrada de otra cuenta con la sesión de
   * esta le pone al envío un firmante que no es el suyo, y el servidor lo rechaza con
   * `forbidden` para siempre: trabajo bueno, perdido por quién tenía la aplicación
   * abierta.
   */
  it('no manda la entrada de otra cuenta, y la deja en la cola', async () => {
    database = freshDatabase();
    const foreign = await readyDraft(database);
    const client = acceptingServer();

    const outcomes = await runOutbox({
      database,
      client,
      put: bucketOk,
      accountId: 'account-b',
    });

    expect(outcomes).toEqual([]);
    expect(submissions(client.calls)).toHaveLength(0);
    expect(await database.outbox.get(foreign)).toBeDefined();
  });

  /** Sin cuenta abierta no hay sesión que pueda firmar por nadie. */
  it('sin cuenta no manda nada', async () => {
    database = freshDatabase();
    await readyDraft(database);
    const client = acceptingServer();

    const outcomes = await runOutbox({ database, client, put: bucketOk, accountId: null });

    expect(outcomes).toEqual([]);
    expect(await database.outbox.count()).toBe(1);
  });
});

describe('outboxFor', () => {
  it('devuelve la entrada con su borrador, solo la de la cuenta', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const mine = await outboxFor(ACCOUNT, database);
    const theirs = await outboxFor('account-b', database);

    expect(mine.map((entry) => entry.row.client_submission_id)).toEqual([id]);
    expect(mine[0]?.draft.scheduled_inspection_id).toBe(INSPECTION_ID);
    expect(theirs).toEqual([]);
  });

  /** Sin borrador no hay payload que armar, así que no se le atribuye a nadie. */
  it('descarta la entrada huérfana sin borrarla', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    await database.drafts.delete(id);

    expect(await outboxFor(ACCOUNT, database)).toEqual([]);
    expect(await database.outbox.get(id)).toBeDefined();
  });
});

/**
 * Lo que ve la PANTALLA, que no es lo mismo que lo que recorre el envío.
 */
describe('deviceWork', () => {
  /**
   * EL REQUISITO ENTERO DE ESTA FUNCIÓN. Un borrador sin firmar no tiene fila de cola, y
   * hasta que esto existió no lo mostraba ninguna pantalla: `outboxFor` no lo puede
   * devolver, y las dos que listan borradores los cuelgan de la inspección pendiente que
   * devuelve el servidor. El indicador de ADR-010 —que no se puede descartar— lo contaba
   * igual, así que el inspector quedaba con un aviso permanente sobre trabajo inalcanzable.
   */
  it('incluye el borrador que todavía no se firmó, con la cola en null', async () => {
    database = freshDatabase();
    const draft = await openDraft(draftInput(), database);
    await saveAnswer(draft.client_submission_id, 'guarding.installed', true, TEST_DOCUMENT, database);

    expect(await outboxFor(ACCOUNT, database)).toEqual([]);

    const work = await deviceWork(ACCOUNT, database);

    expect(work).toHaveLength(1);
    expect(work[0]?.draft.client_submission_id).toBe(draft.client_submission_id);
    expect(work[0]?.row).toBeNull();
  });

  it('trae la fila de cola de lo que ya se firmó', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    const work = await deviceWork(ACCOUNT, database);

    expect(work).toHaveLength(1);
    expect(work[0]?.row?.client_submission_id).toBe(id);
  });

  /**
   * El mismo corte que el indicador: se limpia con la ACEPTACIÓN del servidor y no con la
   * firma. Las dos preguntas salen de `listUnsent` justamente para no poder divergir.
   */
  it('sale de la lista solo cuando el servidor aceptó el envío', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    await database.drafts.update(id, { status: 'signed' });
    expect(await deviceWork(ACCOUNT, database)).toHaveLength(1);

    await database.drafts.update(id, { status: 'accepted' });
    expect(await deviceWork(ACCOUNT, database)).toEqual([]);
  });

  it('no muestra el trabajo de otra cuenta del mismo dispositivo', async () => {
    database = freshDatabase();
    await readyDraft(database);

    expect(await deviceWork('account-b', database)).toEqual([]);
  });
});

/**
 * La pregunta que hace la pantalla de firma para saber a dónde mandar al inspector.
 */
describe('isQueued', () => {
  it('deja de estar en cola solo cuando el servidor la aceptó', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);

    expect(await isQueued(id, database)).toBe(true);

    await sendEntry(id, { database, client: acceptingServer(), put: bucketOk });

    expect(await isQueued(id, database)).toBe(false);
  });

  /** Rechazada sigue en cola: hay algo que mirar, y por eso el destino sigue siendo la cola. */
  it('una entrada rechazada sigue contando como en cola', async () => {
    database = freshDatabase();
    const id = await readyDraft(database);
    await database.outbox.update(id, { state: 'rejected', last_error: 'validation_failed' });

    expect(await isQueued(id, database)).toBe(true);
  });
});

describe('backoffMs', () => {
  it('duplica y tiene tope de cinco minutos', () => {
    expect(backoffMs(1, 0)).toBe(1_000);
    expect(backoffMs(2, 0)).toBe(2_000);
    expect(backoffMs(3, 0)).toBe(4_000);
    expect(backoffMs(20, 0)).toBe(BACKOFF_CAP_MS);
  });

  it('el jitter suma hasta un 20% y nunca resta', () => {
    expect(backoffMs(1, 1)).toBe(1_200);
    expect(backoffMs(1, 0.5)).toBe(1_100);
  });
});
