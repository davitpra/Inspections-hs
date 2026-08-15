import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';
import {
  evaluateVisibility,
  itemsInDocumentOrder,
  negativeAnswers,
  type TemplateDocument,
} from '@hs/forms';

import {
  db,
  type AnswerRow,
  type DraftRow,
  type FindingDraftRow,
  type OfflineDatabase,
  type PhotoRow,
} from './db';
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
  /** Los detalles del hallazgo de cada respuesta negativa, por `item_key`. */
  findings: FindingDraftRow[];
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
 * Se puede descartar lo que todavía no salió del dispositivo, y nada más.
 *
 * ADR-001 — **el envío es el punto de no retorno**. Firmar encola, y una entrada del
 * outbox nunca se descarta: desde ahí el borrador ya no es del inspector, es trabajo que
 * el servidor tiene que recibir. Descartar existe para lo de antes de eso: la inspección
 * que se abrió en la fila equivocada, o la que se empezó y no se va a terminar.
 */
export function isDiscardable(draft: DraftRow): boolean {
  return draft.status === 'capturing';
}

/**
 * Por qué la base se negó a descartar. Lleva el motivo y no un mensaje: el texto que ve
 * el inspector es inglés y se arma en la pantalla (`presentation.ts`), como el resto de
 * la UI. El `message` es para el desarrollador que lea la consola.
 */
export type DiscardRefusal = 'not_owner' | 'already_signed' | 'already_queued';

export class DiscardRefusedError extends Error {
  constructor(readonly reason: DiscardRefusal) {
    super(`El borrador no se puede descartar: ${reason}`);
    this.name = 'DiscardRefusedError';
  }
}

/**
 * Descarta un borrador con todo lo que cuelga de él: respuestas, hallazgos y fotos.
 *
 * Se borra de verdad y no se marca — no es el servidor, donde nunca hay DELETE
 * (ADR-002). Acá el borrador ES el dato que ADR-001 acepta perder, y dejar la fila
 * "descartada" en el dispositivo la seguiría contando en el indicador de trabajo sin
 * enviar, que es la única mitigación verificable del supuesto de los 7 días (ADR-010).
 *
 * Las tres comprobaciones van ADENTRO de la transacción, no en la pantalla:
 *
 * 1. **El dueño.** Igual que `findDraft`: el dispositivo es compartido y acá no hay RLS
 *    que ayude, así que el `account_id` se comprueba en cada escritura.
 * 2. **El estado.** Firmado o aceptado no se descarta.
 * 3. **El outbox.** Es la comprobación que de verdad protege, porque no depende de que
 *    la columna `status` esté sincronizada con la cola: si hay entrada, el envío ya
 *    empezó y borrar el borrador dejaría a `sendEntry` sin qué mandar.
 *
 * Devuelve `false` si no había nada que borrar; lanza si lo había y no se podía.
 */
export async function discardDraft(
  clientSubmissionId: string,
  accountId: string,
  database: OfflineDatabase = db,
): Promise<boolean> {
  return database.transaction(
    'rw',
    database.drafts,
    database.answers,
    database.photos,
    database.findings,
    database.outbox,
    async () => {
      const draft = await database.drafts.get(clientSubmissionId);

      // Descartar dos veces no es un error: la segunda no tiene nada que hacer.
      if (!draft) return false;

      if (draft.account_id !== accountId) throw new DiscardRefusedError('not_owner');
      if (!isDiscardable(draft)) throw new DiscardRefusedError('already_signed');

      if (await database.outbox.get(clientSubmissionId)) {
        throw new DiscardRefusedError('already_queued');
      }

      await Promise.all([
        database.answers.where('client_submission_id').equals(clientSubmissionId).delete(),
        database.photos.where('client_submission_id').equals(clientSubmissionId).delete(),
        database.findings.where('client_submission_id').equals(clientSubmissionId).delete(),
      ]);

      await database.drafts.delete(clientSubmissionId);

      return true;
    },
  );
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

  const [answerRows, photos, findings] = await Promise.all([
    database.answers.where('client_submission_id').equals(clientSubmissionId).toArray(),
    database.photos.where('client_submission_id').equals(clientSubmissionId).toArray(),
    database.findings.where('client_submission_id').equals(clientSubmissionId).toArray(),
  ]);

  return { draft, answers: toAnswerSet(answerRows), photos, findings };
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
  return database.transaction(
    'rw',
    database.answers,
    database.drafts,
    database.findings,
    database.photos,
    async () => {
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

      // La otra mitad de la poda, y la que la etapa 4 agrega: los detalles de un
      // hallazgo cuya respuesta dejó de ser negativa —o cuyo ítem quedó oculto— se
      // borran, junto con sus fotos. Un borrador que arrastra el hallazgo de una
      // respuesta corregida produce un envío con `unexpected_finding`, y el inspector
      // se entera después de firmar.
      const remaining = await database.answers
        .where('client_submission_id')
        .equals(clientSubmissionId)
        .toArray();

      const stillNegative = new Set(negativeAnswers(document, toAnswerSet(remaining)));
      const findingRows = await database.findings
        .where('client_submission_id')
        .equals(clientSubmissionId)
        .toArray();

      for (const row of findingRows) {
        if (stillNegative.has(row.item_key)) continue;

        await database.findings.delete([clientSubmissionId, row.item_key]);
        await database.photos
          .where('[client_submission_id+item_key]')
          .equals([clientSubmissionId, row.item_key])
          .filter((photo) => photo.kind === 'finding')
          .delete();
      }

      // La fila del hallazgo existe desde que la respuesta se vuelve negativa, vacía.
      // Que exista es lo que hace que la pantalla tenga dónde escribir y que
      // `incompleteFindings` pueda nombrar lo que falta sin inventar filas.
      for (const negativeKey of stillNegative) {
        const existing = await database.findings.get([clientSubmissionId, negativeKey]);

        if (existing) continue;

        await database.findings.put({
          client_submission_id: clientSubmissionId,
          item_key: negativeKey,
          description: '',
          location_id: null,
          updated_at: now,
        });
      }

      return { pruned };
    },
  );
}

/**
 * Los detalles del hallazgo, escritos en el acto igual que una respuesta.
 *
 * Acepta un cambio parcial —la descripción sin la ubicación, o al revés— porque el
 * inspector escribe uno y después el otro, y esperar a tener los dos para persistir es
 * volver a abrir la ventana de 300 ms que `saveAnswer` existe para cerrar.
 */
export async function saveFinding(
  clientSubmissionId: string,
  itemKey: string,
  patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>,
  database: OfflineDatabase = db,
): Promise<FindingDraftRow> {
  return database.transaction('rw', database.findings, database.drafts, async () => {
    const draft = await database.drafts.get(clientSubmissionId);
    if (!draft) throw new Error(`No existe el borrador ${clientSubmissionId}`);

    if (draft.status === 'accepted') {
      throw new Error('La inspección ya fue aceptada por el servidor y es de solo lectura');
    }

    const existing = await database.findings.get([clientSubmissionId, itemKey]);

    // Sin fila previa no hay hallazgo que describir: la fila la crea `saveAnswer` al
    // detectar la respuesta negativa. Escribir una acá dejaría detalles de un hallazgo
    // que ninguna respuesta implica.
    if (!existing) throw new Error(`El ítem ${itemKey} no tiene una respuesta negativa`);

    const now = new Date().toISOString();
    const row: FindingDraftRow = { ...existing, ...patch, updated_at: now };

    await database.findings.put(row);
    await database.drafts.update(clientSubmissionId, { updated_at: now });

    return row;
  });
}

/**
 * Qué le falta a cada hallazgo del borrador: la comprobación previa a firmar.
 *
 * Devuelve una entrada por ítem incompleto, con lo que le falta **nombrado**. El
 * requisito no es "no dejar firmar": es que el inspector sepa a qué ítem volver
 * mientras todavía está parado en la planta. Un "faltan datos" a secas lo obliga a
 * recorrer el formulario de nuevo.
 *
 * Corre en el dispositivo y sin red. El servidor rechaza lo mismo con
 * `finding_missing`, pero eso es el respaldo: para entonces el inspector ya firmó y
 * probablemente ya se fue.
 */
export interface IncompleteFinding {
  item_key: string;
  missing: ('description' | 'description_too_short' | 'location' | 'photo')[];
}

export function incompleteFindings(
  document: TemplateDocument,
  answers: Record<string, unknown>,
  findings: readonly FindingDraftRow[],
  photos: readonly PhotoRow[],
): IncompleteFinding[] {
  const byItem = new Map(findings.map((row) => [row.item_key, row]));

  return negativeAnswers(document, answers)
    .map((itemKey) => missingOf(itemKey, byItem.get(itemKey), photos))
    .filter((entry) => entry.missing.length > 0);
}

/**
 * La misma pregunta, respondida SIN el documento: mirando las filas que hay.
 *
 * Una fila de hallazgo existe porque `saveAnswer` vio una respuesta negativa con el
 * documento en la mano, así que las filas ya son la conclusión de esa evaluación. Esto
 * es lo que usa `signDraft`, y por eso la firma no se puede escapar por un documento
 * que no esté guardado: la comprobación no depende de volver a tenerlo.
 */
export function incompleteFindingRows(
  findings: readonly FindingDraftRow[],
  photos: readonly PhotoRow[],
): IncompleteFinding[] {
  return findings
    .map((row) => missingOf(row.item_key, row, photos))
    .filter((entry) => entry.missing.length > 0);
}

function missingOf(
  itemKey: string,
  row: FindingDraftRow | undefined,
  photos: readonly PhotoRow[],
): IncompleteFinding {
  const missing: IncompleteFinding['missing'] = [];

  /**
   * El mínimo es el del contrato, no "no vacío".
   *
   * Con `length === 0` acá, un "ok" de dos letras pasaba la revisión, pasaba la firma,
   * y recién lo paraba el servidor —que hasta el filtro de `ZodError` lo paraba con un
   * `500`, dejando la entrada del outbox reintentando para siempre—. La compuerta tiene
   * que ser la MISMA que la del contrato o no es una compuerta: es un aviso tardío.
   *
   * Vacío y demasiado corto se nombran distinto porque para el inspector no son lo
   * mismo: uno no escribió nada, el otro escribió algo y necesita saber que no alcanza.
   */
  const description = row?.description.trim() ?? '';

  if (description.length === 0) missing.push('description');
  else if (description.length < FINDING_DESCRIPTION_MIN) missing.push('description_too_short');

  if (!row || row.location_id === null) missing.push('location');
  if (!photos.some((photo) => photo.kind === 'finding' && photo.item_key === itemKey)) {
    missing.push('photo');
  }

  return { item_key: itemKey, missing };
}

/** Dónde quedó el inspector. Se guarda al navegar, no solo al contestar. */
export async function setCurrentItem(
  clientSubmissionId: string,
  itemKey: string | null,
  database: OfflineDatabase = db,
): Promise<void> {
  await database.drafts.update(clientSubmissionId, {
    current_item_key: itemKey,
  });
}

/**
 * Lo que se lanza cuando el borrador no se puede firmar todavía. Lleva la lista, no un
 * mensaje: la pantalla tiene que poder nombrar cada ítem y qué le falta.
 */
export class IncompleteFindingsError extends Error {
  constructor(readonly incomplete: readonly IncompleteFinding[]) {
    super(
      `Faltan datos del hallazgo en: ${incomplete.map((entry) => entry.item_key).join(', ')}`,
    );
    this.name = 'IncompleteFindingsError';
  }
}

/**
 * Firmar: el borrador pasa a `signed` y queda listo para el outbox.
 *
 * `signed_at` es el reloj del dispositivo, que puede estar mal. El servidor guarda
 * además el suyo (§5 riesgo C): los dos hacen falta, porque el del dispositivo es
 * cuándo el inspector dice que firmó y el del servidor es cuándo el sistema lo supo.
 *
 * Desde la etapa 4 puede **negarse**: un hallazgo sin descripción, sin ubicación o sin
 * foto detiene la firma con `IncompleteFindingsError`.
 */
export async function signDraft(
  clientSubmissionId: string,
  database: OfflineDatabase = db,
): Promise<DraftRow> {
  return database.transaction(
    'rw',
    database.drafts,
    database.findings,
    database.photos,
    async () => {
      const draft = await database.drafts.get(clientSubmissionId);
      if (!draft) throw new Error(`No existe el borrador ${clientSubmissionId}`);

      if (draft.status === 'accepted') return draft;

      // NO SE FIRMA CON UN HALLAZGO INCOMPLETO (requisitos §3 R2). Acá, en el
      // dispositivo y antes de firmar, porque es el único momento en que el inspector
      // todavía puede volver caminando al lugar. El `finding_missing` del servidor es el
      // respaldo, no la primera línea.
      //
      // Se mira lo que hay en la base y no se reevalúa el documento: las filas de
      // hallazgo existen porque `saveAnswer` ya lo evaluó. Depender del documento acá
      // dejaría que un borrador cuyo `prefetch` se perdió firmara sin comprobar nada.
      const [findingRows, photoRows] = await Promise.all([
        database.findings.where('client_submission_id').equals(clientSubmissionId).toArray(),
        database.photos.where('client_submission_id').equals(clientSubmissionId).toArray(),
      ]);

      const incomplete = incompleteFindingRows(findingRows, photoRows);

      if (incomplete.length > 0) throw new IncompleteFindingsError(incomplete);

      const now = new Date().toISOString();
      await database.drafts.update(clientSubmissionId, {
        status: 'signed',
        signed_at: draft.signed_at ?? now,
        updated_at: now,
      });

      return (await database.drafts.get(clientSubmissionId)) as DraftRow;
    },
  );
}

/**
 * Si esta cuenta puede capturar o firmar esta inspección, según lo que el dispositivo
 * tiene guardado — nunca una pregunta al servidor.
 *
 * `'ok'` cubre dos casos a propósito: la cuenta ES la asignada, y el dispositivo no
 * sabe todavía porque descargó el paquete antes de que `inspector_id` existiera
 * (design D4). Bloquear el segundo caso le negaría el recorrido a un inspector
 * legítimo por una descarga vieja; el que de verdad se equivoque choca igual con el
 * rechazo del servidor al enviar, que es la garantía real y no esto.
 *
 * La MISMA función decide si se abre la captura y si se puede firmar (design D5):
 * las dos preguntas son "¿esta inspección es de esta cuenta, según lo último que se
 * supo sin red?", y una sola respuesta evita que diverjan.
 */
export type CaptureEligibility = 'ok' | 'not_assigned' | 'unassigned';

export function captureEligibility(
  storedInspectorId: string | null | undefined,
  accountId: string,
): CaptureEligibility {
  if (storedInspectorId === undefined) return 'ok';
  if (storedInspectorId === null) return 'unassigned';

  return storedInspectorId === accountId ? 'ok' : 'not_assigned';
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
