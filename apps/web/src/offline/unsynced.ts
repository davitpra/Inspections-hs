import { db, type OfflineDatabase } from './db';

/**
 * Lo que el inspector siempre ve: cuánto de su trabajo no salió del teléfono.
 *
 * ADR-010 asume que se sincroniza dentro de 7 días. Este indicador es lo que convierte
 * ese supuesto en algo que el usuario puede verificar por sí mismo, en vez de algo que
 * el sistema espera. Por eso no es descartable mientras haya trabajo sin enviar.
 */

/** Días sin sincronizar a partir de los cuales la advertencia se muestra (ADR-010). */
export const WARNING_AGE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UnsyncedStatus {
  /** Suma de respuestas de los borradores que el servidor todavía no aceptó. */
  answers: number;
  /** Cuántos borradores sin aceptar hay. */
  drafts: number;
  /** Edad del más viejo, en días. `null` si no hay nada sin enviar. */
  oldestDraftAgeDays: number | null;
  /** A partir de `WARNING_AGE_DAYS`. Lo que la pantalla muestra destacado. */
  warn: boolean;
}

export function emptyStatus(): UnsyncedStatus {
  return { answers: 0, drafts: 0, oldestDraftAgeDays: null, warn: false };
}

/**
 * El estado de una cuenta. Solo la suya: el dispositivo es compartido y el trabajo sin
 * enviar de otra cuenta no es información de esta.
 *
 * D9 — LA EDAD SE CUENTA DESDE `created_at`, NO DESDE `updated_at`, y es la decisión
 * entera de este módulo. "Borrador de hace X días" responde a *cuánto hace que este
 * trabajo no llega al servidor*. Con `updated_at`, un inspector que abre la aplicación
 * todos los días y toca una respuesta reiniciaría el contador, y la advertencia de los
 * 3 días —la única mitigación verificable de ADR-010— no se dispararía nunca.
 */
export async function unsyncedStatus(
  accountId: string,
  database: OfflineDatabase = db,
  now: number = Date.now(),
): Promise<UnsyncedStatus> {
  const drafts = (await database.drafts.where('account_id').equals(accountId).toArray())
    // El indicador se limpia para una inspección SOLO cuando el servidor aceptó su
    // envío. Ni al firmar, ni al encolar, ni al terminar de subir las fotos: aceptado.
    .filter((draft) => draft.status !== 'accepted');

  if (drafts.length === 0) return emptyStatus();

  let answers = 0;

  for (const draft of drafts) {
    answers += await database.answers
      .where('client_submission_id')
      .equals(draft.client_submission_id)
      .count();
  }

  const oldestCreatedAt = Math.min(...drafts.map((draft) => Date.parse(draft.created_at)));
  const oldestDraftAgeDays = Math.floor((now - oldestCreatedAt) / DAY_MS);

  return {
    answers,
    drafts: drafts.length,
    oldestDraftAgeDays,
    warn: oldestDraftAgeDays >= WARNING_AGE_DAYS,
  };
}

/** El texto del requisito, palabra por palabra. Solo inglés: sin i18n (contexto). */
export function unsyncedLabel(status: UnsyncedStatus): string | null {
  if (status.answers === 0 && status.drafts === 0) return null;

  const answers = `${status.answers} answer${status.answers === 1 ? '' : 's'} not submitted`;

  if (status.oldestDraftAgeDays === null) return answers;

  const days = status.oldestDraftAgeDays;
  const age = days === 0 ? 'draft from today' : `draft from ${days} day${days === 1 ? '' : 's'} ago`;

  return `${answers}, ${age}`;
}
