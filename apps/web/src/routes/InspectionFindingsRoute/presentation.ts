import {
  ASSIGNEE,
  FINDING_STATES,
  ROLE_LABELS,
  transitionsFrom,
  type ActionState,
  type ActionSummary,
  type Finding,
  type FindingState,
  type Session,
  type TransitionRequirement,
} from '@hs/contracts';
import {
  evaluateVisibility,
  sectionsInDocumentOrder,
  type AnswerSet,
  type TemplateDocument,
  type TemplateItem,
  type TemplateSection,
} from '@hs/forms';

import { canAttempt, canCreateAction } from '../../permissions/actions';
import { transitionLabel } from '../../presentation/actions';
import { formatDay } from '../../presentation/dates';
import { dueIn } from '../../presentation/inspections';

/**
 * Lo puro de la lectura de hallazgos: qué se dibuja del envío, qué acciones señalan a cada
 * hallazgo, y si el plazo que se escribió en el formulario sirve.
 *
 * Las tres funciones se prueban sin renderizar porque las tres son decisiones —"esta
 * pregunta entra en el recorte", "este hallazgo ya tiene trabajo abierto" y "esta fecha no
 * se puede comprometer"— y una decisión que solo se ve dibujada es una decisión que nadie
 * comprueba.
 */

/** Una pregunta que registró un hallazgo, con el hallazgo que registró. */
export type FoundItem = { item: TemplateItem; finding: Finding };

/**
 * El envío recortado a lo que salió mal: las secciones que dejaron algo, en orden de
 * documento, y dentro de cada una solo las preguntas con hallazgo.
 *
 * **LOS HALLAZGOS SE LEEN DE LO QUE QUEDÓ GUARDADO, no se recalculan.** `negativeAnswers`
 * de `@hs/forms` es la regla que decidió en la captura y en la ingesta qué respuesta abría
 * un hallazgo; volver a correrla acá sería una tercera opinión sobre un registro cerrado,
 * y la primera vez que discrepara la pantalla mostraría algo que la tabla no dice.
 *
 * La visibilidad sí se evalúa, y contra las respuestas REALES: una pregunta que una
 * condición escondió durante el recorrido sigue escondida. Un hallazgo huérfano de una
 * pregunta que no se hizo no puede existir, y si existiera, esta pantalla no es donde se
 * descubre.
 *
 * **Empareja la pregunta con su hallazgo en vez de devolver las dos listas.** Un hallazgo
 * sin el enunciado que lo abrió es una queja suelta; con él es la respuesta negativa de un
 * formulario, que es lo que se defiende ante un regulador. Emparejarlos acá deja además
 * que la pantalla dibuje sin volver a preguntar si hay hallazgo —por construcción lo hay—
 * y sirve para lo que necesita antes de dibujar: saber si quedó algo (si no, hay que
 * decirlo en vez de quedarse en blanco bajo un encabezado) y numerar las secciones sin
 * huecos.
 */
export function sectionsWithFindings(
  document: TemplateDocument,
  answers: AnswerSet,
  findings: readonly Finding[],
): [TemplateSection, FoundItem[]][] {
  const visibility = evaluateVisibility(document, answers);
  const byItemKey = new Map(findings.map((finding) => [finding.item_key, finding] as const));

  return sectionsInDocumentOrder(document)
    .map(([section, items]): [TemplateSection, FoundItem[]] => [
      section,
      items.flatMap((item) => {
        const finding = visibility[item.item_key] ? byItemKey.get(item.item_key) : undefined;

        return finding ? [{ item, finding }] : [];
      }),
    ])
    .filter(([, items]) => items.length > 0);
}

/**
 * Las acciones correctivas de cada hallazgo, indexadas por el id del hallazgo.
 *
 * **Se agrupa por `source.finding_id` y no por un campo del hallazgo**, porque el hallazgo
 * no tiene ninguno: `findingSchema` no lleva estado ni conteo, y esa ausencia es
 * deliberada —lo que se hizo con un hallazgo son sus acciones, que se leen por su cuenta—.
 * La relación solo existe del lado de la acción.
 *
 * Las acciones de una investigación no tienen `finding_id` y quedan afuera solas: la unión
 * discriminada de `ActionSource` solo lo trae en las variantes `inspection` y
 * `manual_finding`.
 *
 * Devuelve un `Map` y no una lista emparejada con los hallazgos porque esta pantalla ya
 * tiene los hallazgos dibujados en el orden del documento congelado: lo único que le falta
 * es poder preguntar por uno.
 */
export function actionsByFinding(
  actions: readonly ActionSummary[],
): Map<string, ActionSummary[]> {
  const byFinding = new Map<string, ActionSummary[]>();

  for (const action of actions) {
    if (!('finding_id' in action.source)) continue;

    const group = byFinding.get(action.source.finding_id);

    if (group) group.push(action);
    else byFinding.set(action.source.finding_id, [action]);
  }

  return byFinding;
}

/** El orden del stream propio del hallazgo; el contrato y la UI comparten la misma lista. */
export const FINDING_STAGES = FINDING_STATES;

export type FindingStage = FindingState;

export const STAGE_LABELS: Readonly<Record<FindingStage, string>> = {
  raised: 'Raised',
  assigned: 'Assigned',
  in_progress: 'In progress',
  verification: 'Verification',
  closed: 'Closed',
};

const STAGE_BY_ACTION_STATE: Readonly<Record<ActionState, FindingStage>> = {
  open: 'assigned',
  in_progress: 'in_progress',
  awaiting_verification: 'verification',
  closed: 'closed',
};

/** Las acciones que retienen la etapa vigente, primero la que vence antes. */
export function blockingActions(
  actions: readonly ActionSummary[],
  current: FindingState,
): ActionSummary[] {
  return actions
    .filter((action) => STAGE_BY_ACTION_STATE[action.state] === current)
    .sort((left, right) => left.due_at.localeCompare(right.due_at));
}

export type StageStatus = 'done' | 'current' | 'todo';

/** Qué dibuja un segmento con respecto a la etapa vigente. */
export function stageStatus(stage: FindingStage, current: FindingStage): StageStatus {
  const distance = FINDING_STAGES.indexOf(stage) - FINDING_STAGES.indexOf(current);

  if (distance < 0) return 'done';
  return distance === 0 ? 'current' : 'todo';
}

/** El plazo más cercano entre las acciones que retienen el hallazgo en su etapa. */
export function findingDeadline(
  actions: readonly ActionSummary[],
  state: FindingState,
  today: string,
): string | null {
  const nearest = blockingActions(actions, state)[0];

  return nearest ? dueIn(formatDay(nearest.due_at), today) : null;
}

export type FindingNextStep = {
  label: string;
  requirement: string;
  waitingOn: string;
  control: { kind: 'create' } | { kind: 'progress'; action: ActionSummary } | null;
};

const REQUIREMENT_LABELS: Readonly<Record<TransitionRequirement, string>> = {
  not_executor: 'A verifier other than the person who declared the work done must submit it.',
  reason: 'A reason is required.',
};

function transitionRequirement(requirements: readonly TransitionRequirement[]): string {
  return requirements.length === 0
    ? 'No additional information is required.'
    : requirements.map((requirement) => REQUIREMENT_LABELS[requirement]).join(' ');
}

function transitionOwner(action: ActionSummary): string {
  const transition = transitionsFrom(action.state)[0];

  if (!transition) return '';
  if (transition.roles.includes(ASSIGNEE)) return action.assignee_name ?? 'Assigned person';

  return transition.roles
    .filter((role) => role !== ASSIGNEE)
    .map((role) => ROLE_LABELS[role])
    .join(', ');
}

/**
 * El único acto principal que sigue, consultado en la misma tabla que aplica el servidor.
 * `null` significa que todas las acciones están cerradas y no existe reapertura.
 *
 * La rama `raised` necesita el hallazgo, y no solo la sesión: desde ADR-017 quien lo
 * puede abrir no es solo el coordinador, también la cuenta que reportó ESE hallazgo.
 */
export function nextStep(
  actions: readonly ActionSummary[],
  state: FindingState,
  session: Session | null,
  finding: Pick<Finding, 'reported_by'>,
): FindingNextStep | null {
  if (state === 'raised') {
    return {
      label: 'Create corrective action',
      requirement: 'Assign a responsible person, describe the work, and set a deadline.',
      waitingOn: `${ROLE_LABELS.hs_coordinator} or whoever raised the finding`,
      control: canCreateAction(session, finding) ? { kind: 'create' } : null,
    };
  }

  const action = blockingActions(actions, state)[0];
  if (!action) return null;

  const transitions = transitionsFrom(action.state);
  const allowed = transitions.find((transition) => canAttempt(transition, action, session));
  const transition = allowed ?? transitions[0];

  if (!transition) return null;

  return {
    label: transitionLabel(action.state, transition.to),
    requirement: transitionRequirement(transition.requires),
    waitingOn: transitionOwner(action),
    control: allowed ? { kind: 'progress', action } : null,
  };
}

export type DueAtResult =
  | { success: true; dueAt: string }
  | { success: false; message: string };

/** Convierte el valor local del navegador a un instante ISO y comprueba el plazo al enviar. */
export function futureDueAt(value: string, now: Date): DueAtResult {
  const instant = new Date(value);

  if (value === '' || Number.isNaN(instant.getTime())) {
    return { success: false, message: 'Choose a valid deadline.' };
  }

  if (instant.getTime() <= now.getTime()) {
    return { success: false, message: 'Deadline must be in the future.' };
  }

  return { success: true, dueAt: instant.toISOString() };
}
