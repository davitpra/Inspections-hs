import { acceptedSubmissionSchema, type InspectionSubmission } from '@hs/contracts';

import { sessionClient } from '../api/client';
import type { SessionClient } from '../auth/session-client';
import { db, type OfflineDatabase, type OutboxRow } from './db';
import { toAnswerSet } from './drafts';
import { uploadPendingPhotos, uploadedKeysByItem, type UploadDeps } from './photos';

/**
 * La cola de salida. Una entrada por inspección, un solo envío en vuelo, y **una
 * entrada nunca se descarta**.
 *
 * D2 — corre en la ventana y no en el service worker: garantizar "un solo envío en
 * vuelo" es más fácil en un contexto que en dos. El `TokenStore` ya vive en Dexie (D10)
 * para que mudarlo más adelante no requiera tocar la sesión.
 */

/** El identificador de ESTA instancia, para el lock de D3. */
const INSTANCE_ID = crypto.randomUUID();

/**
 * Cuánto puede durar un envío antes de que su lock se considere abandonado.
 *
 * Holgado respecto de un submit sin fotos —las fotos ya subieron antes— y aun así
 * finito: sin robo de locks, un tab que muere a mitad de un envío bloquea la entrada
 * para siempre y el inspector no tiene forma de destrabarla.
 *
 * ROBAR UN LOCK PUEDE PRODUCIR DOS ENVÍOS CONCURRENTES DEL MISMO ID, y es aceptable:
 * es exactamente lo que `client_submission_id` existe para absorber (ADR-001). Acá se
 * reduce la frecuencia; el servidor garantiza la corrección.
 */
export const LOCK_TIMEOUT_MS = 60_000;

/** 1s, 2s, 4s… con tope de 5 minutos y jitter (D8). */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 5 * 60_000;

export type SendOutcome =
  | { kind: 'accepted' }
  /** Fotos sin subir: no se envía todavía y no cuenta como intento fallido. */
  | { kind: 'waiting_for_photos'; pending: number }
  | { kind: 'retry'; reason: string }
  /** `4xx` de validación: la entrada se detiene y se muestra con el motivo. */
  | { kind: 'rejected'; reason: string }
  /** La sesión no se pudo renovar. La entrada QUEDA en cola y se pide login. */
  | { kind: 'sign_in_required' }
  /** Otra instancia la tiene tomada, o todavía no llegó su turno. */
  | { kind: 'skipped' };

export interface OutboxDeps extends UploadDeps {
  database?: OfflineDatabase;
  client?: SessionClient;
  now?: () => number;
  /** Solo para los tests: sin jitter el backoff no se puede afirmar. */
  jitter?: () => number;
}

/**
 * Encolar al firmar. Una entrada por inspección: encolar dos veces la misma no crea
 * una segunda, y por eso el `client_submission_id` es la clave primaria también acá.
 */
export async function enqueue(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<OutboxRow> {
  return database.transaction('rw', database.outbox, async () => {
    const existing = await database.outbox.get(clientSubmissionId);
    if (existing) return existing;

    const row: OutboxRow = {
      client_submission_id: clientSubmissionId,
      state: 'queued',
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
      sending_since: null,
      lock_owner: null,
    };

    await database.outbox.add(row);

    return row;
  });
}

/**
 * Toma el lock de una entrada, o devuelve `null` si otra instancia lo tiene.
 *
 * D3 — el lock es una fila y no una variable de módulo. Una bandera en memoria protege
 * contra dos llamadas del mismo contexto y contra nada más: dos tabs de la PWA
 * enviarían el mismo `client_submission_id` dos veces y la idempotencia del servidor
 * pasaría de ser la última defensa a ser la única.
 *
 * La transacción `readwrite` de Dexie es atómica entre tabs porque IndexedDB lo es: el
 * leer-y-escribir de acá adentro no se intercala con el de otro contexto.
 */
async function acquire(
  clientSubmissionId: string,
  now: number,
  database: OfflineDatabase,
): Promise<OutboxRow | null> {
  return database.transaction('rw', database.outbox, async () => {
    const row = await database.outbox.get(clientSubmissionId);

    if (!row) return null;
    if (row.state === 'rejected') return null;
    if (row.next_attempt_at > now) return null;

    const heldByOther =
      row.sending_since !== null && now - row.sending_since < LOCK_TIMEOUT_MS;

    if (heldByOther) return null;

    await database.outbox.update(clientSubmissionId, {
      sending_since: now,
      lock_owner: INSTANCE_ID,
    });

    return { ...row, sending_since: now, lock_owner: INSTANCE_ID };
  });
}

async function release(
  clientSubmissionId: string,
  database: OfflineDatabase,
): Promise<void> {
  const row = await database.outbox.get(clientSubmissionId);

  // Solo suelta el lock quien lo tiene. Si otra instancia lo robó, soltarlo acá
  // desprotegería un envío que está en curso ahora mismo.
  if (row?.lock_owner !== INSTANCE_ID) return;

  await database.outbox.update(clientSubmissionId, { sending_since: null, lock_owner: null });
}

/**
 * Envía UNA entrada.
 *
 * El orden importa y no es negociable: primero las fotos, después el formulario. Un
 * envío no sale mientras alguna de sus fotos esté sin subir — el payload referenciaría
 * una object key que no existe.
 */
export async function sendEntry(
  clientSubmissionId: string,
  deps: OutboxDeps = {},
): Promise<SendOutcome> {
  const database = deps.database ?? db;
  const client = deps.client ?? sessionClient;
  const now = deps.now ?? Date.now;

  const entry = await acquire(clientSubmissionId, now(), database);
  if (!entry) return { kind: 'skipped' };

  try {
    const draft = await database.drafts.get(clientSubmissionId);
    if (!draft) return { kind: 'skipped' };
    if (draft.status === 'accepted') return { kind: 'accepted' };

    // El gancho de la etapa 1: se refresca ANTES del primer envío, no después del
    // primer 401. Descubrirlo después cuesta un reintento por entrada, sobre la red de
    // una planta, con un inspector esperando.
    if (!(await client.ensureFreshSession())) {
      return { kind: 'sign_in_required' };
    }

    const pending = await uploadPendingPhotos(
      clientSubmissionId,
      draft.scheduled_inspection_id,
      deps,
    );

    if (pending > 0) return { kind: 'waiting_for_photos', pending };

    const answers = await database.answers
      .where('client_submission_id')
      .equals(clientSubmissionId)
      .toArray();

    const payload: InspectionSubmission = {
      // D4 — el de la fila, no uno nuevo. Todo intento de esta inspección lleva este.
      client_submission_id: draft.client_submission_id,
      scheduled_inspection_id: draft.scheduled_inspection_id,
      template_version_id: draft.template_version_id,
      answers: toAnswerSet(answers) as InspectionSubmission['answers'],
      // Object keys, nunca bytes (ADR-001).
      photos: await uploadedKeysByItem(clientSubmissionId, 'answer', database),
      findings: await findingsBlock(clientSubmissionId, database),
      signed_at: draft.signed_at ?? new Date(now()).toISOString(),
    };

    const result = await client.request<unknown>('/inspection-submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (result.ok) {
      acceptedSubmissionSchema.parse(result.value);
      await accept(clientSubmissionId, database);

      return { kind: 'accepted' };
    }

    return classify(clientSubmissionId, result.code, result.message, deps);
  } catch (error) {
    // Red caída, DNS, timeout: todo esto reintenta. Es la mitad del mundo en la que
    // este sistema vive.
    return retryLater(
      clientSubmissionId,
      error instanceof Error ? error.message : String(error),
      deps,
    );
  } finally {
    await release(clientSubmissionId, database);
  }
}

/**
 * D8 — La clasificación de la respuesta.
 *
 * `SessionClient` devuelve códigos tipados y no status crudos, que es lo que permite
 * separar los dos `401`: `token_expired` ya se reintentó adentro del cliente, y
 * `session_ended` significa pedir login **conservando** la entrada.
 *
 * `409` se trata como éxito: un reenvío del mismo `client_submission_id` devuelve el
 * registro existente (ADR-001). Si llegara un conflicto igual, el registro existe, que
 * es todo lo que el dispositivo quería.
 */
async function classify(
  clientSubmissionId: string,
  code: string,
  message: string,
  deps: OutboxDeps,
): Promise<SendOutcome> {
  const database = deps.database ?? db;
  const client = deps.client ?? sessionClient;

  if (code === 'session_ended' || code === 'token_expired') {
    /**
     * Antes de pedir login, se comprueba que la sesión esté REALMENTE caída.
     *
     * `readError` de `session-client.ts` devuelve `session_ended` ante cualquier
     * respuesta sin código tipado —un `404` de una ruta que no existe, un `502` de un
     * proxy, una página de error en HTML—, y ese default protege lo que tiene que
     * proteger: la cola no se descarta. Pero si se creyera al pie de la letra, esos
     * errores no contarían como intento ni programarían retroceso, y cada disparador
     * reintentaría al instante. Es exactamente el martilleo que D8 existe para evitar.
     *
     * Si la sesión sigue viva, entonces el `session_ended` era una etiqueta prestada y
     * lo que hubo fue un error de servidor: reintenta con retroceso.
     */
    if (await client.ensureFreshSession()) {
      return retryLater(clientSubmissionId, message, deps);
    }

    // NO cuenta como intento y NO se descarta: la sesión es un problema de la sesión.
    return { kind: 'sign_in_required' };
  }

  if (code === 'already_submitted' || code === 'conflict') {
    await accept(clientSubmissionId, database);
    return { kind: 'accepted' };
  }

  if (NON_RETRYABLE.has(code)) {
    await database.outbox.update(clientSubmissionId, { state: 'rejected', last_error: message });

    // El borrador y sus respuestas QUEDAN legibles en el dispositivo. Una entrada
    // rechazada es trabajo que hay que arreglar, no trabajo que se tira.
    return { kind: 'rejected', reason: message };
  }

  return retryLater(clientSubmissionId, message, deps);
}

/**
 * El bloque de hallazgos del payload (requisitos §3 R2, etapa 4).
 *
 * Se arma de lo que hay en el dispositivo, sin volver a decidir qué respuesta es
 * negativa: la fila del hallazgo existe porque `saveAnswer` la creó al detectarlo, y la
 * comprobación previa a firmar ya garantizó que esté completa. Reevaluar acá sería
 * responder dos veces la misma pregunta, con la segunda respuesta llegando después de
 * la firma.
 *
 * Una fila incompleta que se colara igual llega al servidor y vuelve como
 * `validation_failed`, que es el respaldo correcto: la entrada no se reintenta y el
 * borrador queda legible.
 */
async function findingsBlock(
  clientSubmissionId: string,
  database: OfflineDatabase,
): Promise<InspectionSubmission['findings']> {
  const [rows, keysByItem] = await Promise.all([
    database.findings.where('client_submission_id').equals(clientSubmissionId).toArray(),
    uploadedKeysByItem(clientSubmissionId, 'finding', database),
  ]);

  return Object.fromEntries(
    rows.map((row) => [
      row.item_key,
      {
        description: row.description,
        location_id: row.location_id ?? '',
        photo_object_keys: keysByItem[row.item_key] ?? [],
      },
    ]),
  );
}

/**
 * Los códigos que no vuelven a andar por reintentar. Reintentar eternamente un payload
 * que el servidor considera inválido es un bucle que consume batería y no converge.
 */
const NON_RETRYABLE = new Set([
  'validation_failed',
  'invalid_submission',
  'forbidden',
  'inspection_not_found',
]);

async function retryLater(
  clientSubmissionId: string,
  reason: string,
  deps: OutboxDeps,
): Promise<SendOutcome> {
  const database = deps.database ?? db;
  const now = (deps.now ?? Date.now)();
  const jitter = deps.jitter ?? Math.random;

  const row = await database.outbox.get(clientSubmissionId);
  const attempts = (row?.attempts ?? 0) + 1;

  await database.outbox.update(clientSubmissionId, {
    attempts,
    last_error: reason,
    next_attempt_at: now + backoffMs(attempts, jitter()),
  });

  return { kind: 'retry', reason };
}

/** 1s, 2s, 4s… hasta 5 minutos, con hasta un 20% de jitter para no sincronizar tabs. */
export function backoffMs(attempts: number, jitter = Math.random()): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);

  return Math.round(base * (1 + jitter * 0.2));
}

/**
 * La entrada se elimina **solo** después de que el servidor la aceptó. En ningún otro
 * camino de este archivo hay un `outbox.delete`.
 */
async function accept(clientSubmissionId: string, database: OfflineDatabase): Promise<void> {
  await database.transaction('rw', database.outbox, database.drafts, async () => {
    await database.drafts.update(clientSubmissionId, { status: 'accepted' });
    await database.outbox.delete(clientSubmissionId);
  });
}

/**
 * Una corrida de la cola: intenta todas las entrada que ya tienen turno.
 *
 * En serie y no en paralelo: la red de una planta con dos envíos compitiendo es peor
 * que con uno, y el requisito de "un solo envío en vuelo" ya lo garantiza el lock —
 * esto solo evita provocarlo.
 */
export async function runOutbox(deps: OutboxDeps = {}): Promise<SendOutcome[]> {
  const database = deps.database ?? db;
  const entries = await database.outbox.toArray();
  const outcomes: SendOutcome[] = [];

  for (const entry of entries) {
    outcomes.push(await sendEntry(entry.client_submission_id, deps));
  }

  return outcomes;
}

/**
 * Los disparadores: al montar la aplicación, al volver la conectividad, y al terminar
 * una inspección (esa la dispara la pantalla).
 *
 * Sin Background Sync (Non-Goal de `design.md`): soporte desigual y aporta poco con un
 * supuesto de 7 días. Es también por eso que el indicador permanente es obligatorio —
 * un envío requiere que el inspector abra la aplicación, y tiene que saberlo.
 */
export function startOutbox(deps: OutboxDeps = {}): () => void {
  const run = (): void => {
    void runOutbox(deps);
  };

  run();
  globalThis.addEventListener?.('online', run);

  return () => globalThis.removeEventListener?.('online', run);
}
