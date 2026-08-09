import { evaluateVisibility, itemsInDocumentOrder, type TemplateDocument } from '@hs/forms';

import { db, type AnswerRow, type DraftRow, type OfflineDatabase, type PhotoRow } from './db';
import { storedTemplateVersion } from './prefetch';

/**
 * El borrador: lo que el inspector va llenando, escrito respuesta por respuesta.
 *
 * ADR-001 — un dueño, un dispositivo, un firmante. Nada de esto converge con nada: es
 * un borrador que se convierte en un envío y muere.
 */

export interface DraftOwner {
  account_id: string;
  site_id: string;
}

export interface OpenDraftInput extends DraftOwner {
  scheduled_inspection_id: string;
  template_version_id: string;
}

/** El borrador con todo lo que la pantalla necesita para reanudar sin red. */
export interface LoadedDraft {
  draft: DraftRow;
  answers: Record<string, unknown>;
  photos: PhotoRow[];
}

/**
 * Abre el borrador de una inspección para una cuenta: devuelve el que haya, o crea uno.
 *
 * D4 — `client_submission_id` se genera ACÁ, con el borrador, y no al enviar. Es la
 * clave primaria de la fila: no hay `put` que lo pueda regenerar por accidente y no
 * existe un camino de código donde el borrador exista sin él. `crypto.randomUUID()`
 * requiere contexto seguro, que la PWA siempre tiene.
 *
 * Una inspección cuyo envío el servidor ya aceptó NO genera un borrador nuevo: se
 * devuelve el aceptado, y la pantalla lo presenta de solo lectura.
 */
export async function openDraft(
  input: OpenDraftInput,
  database: OfflineDatabase = db,
): Promise<DraftRow> {
  return database.transaction('rw', database.drafts, async () => {
    const existing = await findDraft(
      input.scheduled_inspection_id,
      input.account_id,
      database,
    );

    if (existing) return existing;

    const now = new Date().toISOString();
    const row: DraftRow = {
      client_submission_id: crypto.randomUUID(),
      scheduled_inspection_id: input.scheduled_inspection_id,
      account_id: input.account_id,
      site_id: input.site_id,
      template_version_id: input.template_version_id,
      created_at: now,
      updated_at: now,
      current_item_key: null,
      status: 'capturing',
      signed_at: null,
    };

    await database.drafts.add(row);

    return row;
  });
}

/**
 * El borrador de esta inspección **para esta cuenta**.
 *
 * El filtro por `account_id` es el aislamiento entero: el dispositivo es compartido y
 * un borrador de la cuenta A no se le lista ni se le lee a la cuenta B. Acá no hay RLS
 * que ayude — es una base local— así que la regla vive en cada consulta y por eso hay
 * una sola función que las hace.
 */
export async function findDraft(
  scheduledInspectionId: string,
  accountId: string,
  database: OfflineDatabase = db,
): Promise<DraftRow | undefined> {
  const rows = await database.drafts
    .where('scheduled_inspection_id')
    .equals(scheduledInspectionId)
    .toArray();

  return rows.find((row) => row.account_id === accountId);
}

/** Los borradores de una cuenta, del más viejo al más nuevo. */
export async function listDrafts(
  accountId: string,
  database: OfflineDatabase = db,
): Promise<DraftRow[]> {
  const rows = await database.drafts.where('account_id').equals(accountId).toArray();

  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Reabrir: respuestas, el ítem en el que estaba y sus fotos. Sin una sola petición de
 * red — todo esto ya está en el dispositivo.
 */
export async function loadDraft(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<LoadedDraft | null> {
  const draft = await database.drafts.get(clientSubmissionId);
  if (!draft) return null;

  const [answerRows, photos] = await Promise.all([
    database.answers.where('client_submission_id').equals(clientSubmissionId).toArray(),
    database.photos.where('client_submission_id').equals(clientSubmissionId).toArray(),
  ]);

  return { draft, answers: toAnswerSet(answerRows), photos };
}

export function toAnswerSet(rows: readonly AnswerRow[]): Record<string, unknown> {
  return Object.fromEntries(rows.map((row) => [row.item_key, row.value]));
}

/**
 * Escribe UNA respuesta, y poda las que quedaron ocultas, en la misma transacción.
 *
 * Dos requisitos viven acá y ninguno admite atajos:
 *
 * 1. **Se escribe antes de que la pantalla siguiente se pinte. Sin debounce.** Un
 *    debounce de 300 ms es una ventana de 300 ms en la que Android puede matar el
 *    proceso, y el requisito dice que no se pierde una respuesta ya ingresada.
 * 2. **Un ítem oculto no conserva respuesta** (D6). Se recalcula la visibilidad con el
 *    motor compartido y se BORRAN las respuestas de los ítems que quedaron ocultos.
 *    Guardarlas "por si acaso" y filtrarlas al enviar haría que el contador de "N
 *    respuestas sin enviar" mienta, y ese contador es la única mitigación verificable
 *    del supuesto de los 7 días (ADR-010).
 *
 * Todo dentro de una transacción `readwrite`: o queda la respuesta con la poda que le
 * corresponde, o no queda nada. Nunca un estado intermedio que el motor no pueda
 * explicar.
 */
export async function saveAnswer(
  clientSubmissionId: string,
  itemKey: string,
  value: unknown,
  document: TemplateDocument,
  database: OfflineDatabase = db,
): Promise<{ pruned: string[] }> {
  return database.transaction('rw', database.answers, database.drafts, async () => {
    const draft = await database.drafts.get(clientSubmissionId);
    if (!draft) throw new Error(`No existe el borrador ${clientSubmissionId}`);

    // Una inspección cuyo envío el servidor aceptó está cerrada. La comprobación va
    // adentro de la transacción: afuera sería una carrera con el outbox.
    if (draft.status === 'accepted') {
      throw new Error('La inspección ya fue aceptada por el servidor y es de solo lectura');
    }

    const now = new Date().toISOString();

    if (isEmpty(value)) {
      await database.answers.delete([clientSubmissionId, itemKey]);
    } else {
      await database.answers.put({
        client_submission_id: clientSubmissionId,
        item_key: itemKey,
        value,
        answered_at: now,
      });
    }

    const rows = await database.answers
      .where('client_submission_id')
      .equals(clientSubmissionId)
      .toArray();

    const visibility = evaluateVisibility(document, toAnswerSet(rows));
    const known = new Set(itemsInDocumentOrder(document).map((item) => item.item_key));

    // Se poda lo oculto Y lo que el documento no contiene: una respuesta huérfana de un
    // ítem que ya no existe contaría en el indicador y no se podría contestar.
    const pruned = rows
      .map((row) => row.item_key)
      .filter((key) => key !== itemKey && (!known.has(key) || visibility[key] === false));

    for (const key of pruned) {
      await database.answers.delete([clientSubmissionId, key]);
    }

    await database.drafts.update(clientSubmissionId, {
      current_item_key: itemKey,
      updated_at: now,
    });

    return { pruned };
  });
}

/** Dónde quedó el inspector. Se guarda al navegar, no solo al contestar. */
export async function setCurrentItem(
  clientSubmissionId: string,
  itemKey: string | null,
  database: OfflineDatabase = db,
): Promise<void> {
  await database.drafts.update(clientSubmissionId, { current_item_key: itemKey });
}

/**
 * Firmar: el borrador pasa a `signed` y queda listo para el outbox.
 *
 * `signed_at` es el reloj del dispositivo, que puede estar mal. El servidor guarda
 * además el suyo (§5 riesgo C): los dos hacen falta, porque el del dispositivo es
 * cuándo el inspector dice que firmó y el del servidor es cuándo el sistema lo supo.
 */
export async function signDraft(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<DraftRow> {
  return database.transaction('rw', database.drafts, async () => {
    const draft = await database.drafts.get(clientSubmissionId);
    if (!draft) throw new Error(`No existe el borrador ${clientSubmissionId}`);

    if (draft.status === 'accepted') return draft;

    const now = new Date().toISOString();
    await database.drafts.update(clientSubmissionId, {
      status: 'signed',
      signed_at: draft.signed_at ?? now,
      updated_at: now,
    });

    return (await database.drafts.get(clientSubmissionId)) as DraftRow;
  });
}

/**
 * El documento contra el que se interpreta ESTE borrador: el congelado que bajó la
 * descarga previa, nunca el más reciente publicado.
 */
export async function documentForDraft(
  draft: DraftRow,
  database: OfflineDatabase = db,
): Promise<TemplateDocument | null> {
  const stored = await storedTemplateVersion(draft.scheduled_inspection_id, database);

  if (!stored) return null;

  // Si lo guardado no es la versión a la que la inspección está atada, no se interpreta
  // con lo que haya: se trata como no descargada. Interpretar con la versión equivocada
  // es peor que no poder capturar, porque produce un envío que el servidor rechaza
  // después de las tres horas de recorrido.
  return stored.template_version_id === draft.template_version_id ? stored.document : null;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;

  return false;
}
