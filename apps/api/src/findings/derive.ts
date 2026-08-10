import type { FindingDetails, SubmissionFindings } from '@hs/contracts';
import { negativeAnswers, type AnswerSet, type TemplateDocument } from '@hs/forms';

/**
 * ADR-008, costura crítica 1 — el paso que 0009 dejó marcado con un comentario:
 * `insertar Respuestas → DERIVAR HALLAZGOS → escribir eventos`.
 *
 * Esta función es la mitad pura de ese paso: decide qué hallazgos salen del envío y
 * qué le falta al envío para poder salir. No toca base, no arma SQL y no sabe qué
 * `template_version_item_id` le corresponde a cada `item_key` — eso lo resuelve el
 * servicio, que ya tiene la transacción abierta.
 *
 * Vive en `findings` y no en `inspections` por la dirección de dependencias de
 * ADR-008: `findings` conoce `inspections`, no al revés. La ingesta importa esta
 * función; el módulo `findings` no importa nada de la ingesta.
 */

/**
 * Los dos códigos que este paso agrega a `validateAnswers`.
 *
 * Son violaciones y no un error propio: viajan en la misma respuesta
 * `validation_failed`, en la misma lista, con el mismo `item_key`. Para el outbox
 * del dispositivo es el mismo código no reintentable que ya sabe clasificar, así
 * que `apps/web/src/offline/outbox.ts` no cambia.
 */
export const FINDING_VIOLATION_CODES = [
  /** Una respuesta negativa que llegó sin descripción, ubicación y foto. */
  'finding_missing',
  /** Detalles de hallazgo para una respuesta que no es negativa. */
  'unexpected_finding',
] as const;

export type FindingViolationCode = (typeof FINDING_VIOLATION_CODES)[number];

export interface FindingViolation {
  readonly item_key: string;
  readonly code: FindingViolationCode;
}

/** Un hallazgo por derivar: la `item_key` que falló y lo que el inspector describió. */
export interface DerivedFinding {
  readonly item_key: string;
  readonly details: FindingDetails;
}

export type DeriveResult =
  | { readonly ok: true; readonly findings: readonly DerivedFinding[] }
  | { readonly ok: false; readonly violations: readonly FindingViolation[] };

/**
 * Compara las respuestas negativas del envío con el bloque `findings` que trae.
 *
 * Los dos conjuntos tienen que coincidir **exactamente**. Una respuesta negativa sin
 * detalles es un hallazgo que no se puede arreglar —R2 exige descripción, ubicación y
 * foto— y unos detalles sin respuesta negativa son un hallazgo que nadie encontró.
 *
 * Las violaciones salen en orden de documento y las sobrantes al final, para que la
 * lista que ve el inspector siga el recorrido y no el orden de las claves de un
 * objeto.
 *
 * No comprueba la forma de los detalles: eso ya lo hizo `inspectionSubmissionSchema`
 * antes de que el servicio viera el payload. Acá solo se compara qué claves hay.
 */
export function deriveFindings(
  document: TemplateDocument,
  answers: AnswerSet,
  findings: SubmissionFindings,
): DeriveResult {
  const negative = negativeAnswers(document, answers);
  const negativeSet = new Set(negative);
  const violations: FindingViolation[] = [];
  const derived: DerivedFinding[] = [];

  for (const itemKey of negative) {
    const details = findings[itemKey];

    if (details === undefined) {
      violations.push({ item_key: itemKey, code: 'finding_missing' });
    } else {
      derived.push({ item_key: itemKey, details });
    }
  }

  for (const itemKey of Object.keys(findings)) {
    if (!negativeSet.has(itemKey)) {
      violations.push({ item_key: itemKey, code: 'unexpected_finding' });
    }
  }

  if (violations.length > 0) return { ok: false, violations };

  return { ok: true, findings: derived };
}

/**
 * Toda object key que el bloque de hallazgos referencia.
 *
 * La verificación de prefijo de `inspections/submission.ts` tiene que cubrirlas: si
 * no, el bloque nuevo sería el agujero por el que un dispositivo comprometido hace
 * que el registro legal de una inspección apunte a las fotos de la otra planta.
 */
export function findingObjectKeys(findings: SubmissionFindings): string[] {
  return Object.values(findings).flatMap((details) => [...details.photo_object_keys]);
}
