import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  ASSIGNEE,
  createActionRequestSchema,
  FINDING_STATES,
  ROLE_LABELS,
  transitionsFrom,
  type ActionEvent,
  type ActionState,
  type ActionSummary,
  type CreateActionRequest,
  type Finding,
  type FindingState,
  type PersonOption,
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

import { canAmendAssignment, canAttempt, canCreateAction } from '../../permissions/actions';
import { STATE_LABELS, transitionLabel } from '../../presentation/actions';
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

/**
 * En qué etapa del hallazgo cae cada estado de una acción.
 *
 * Exportada porque el registro de una etapa reparte los eventos con ESTA tabla, la misma con
 * la que `blockingActions` decide cuál acción retiene la etapa vigente. Dos tablas —una para
 * decidir y otra para leer— es la forma en que el ciclo dibujado y el ciclo aplicado
 * empiezan a discrepar.
 */
export const STAGE_BY_ACTION_STATE: Readonly<Record<ActionState, FindingStage>> = {
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

/**
 * Las etapas que el hallazgo ya alcanzó, y por eso las únicas que se pueden abrir.
 *
 * Una etapa por delante no tiene registro que mostrar: no es que esté vacía, es que todavía
 * no ocurrió, y ofrecerla como control prometería una lectura que no existe.
 */
export function reachedStages(current: FindingStage): FindingStage[] {
  return FINDING_STAGES.filter((stage) => stageStatus(stage, current) !== 'todo');
}

/**
 * Los eventos que escribieron ESTA etapa, en el orden del stream.
 *
 * Se ordena por `position` y no por `occurred_at`: el orden dentro de la acción es el que el
 * servidor conserva (design D1), y dos eventos del mismo segundo no pueden quedar dados
 * vuelta por el reloj.
 */
export function eventsInStage(
  events: readonly ActionEvent[],
  stage: FindingStage,
): ActionEvent[] {
  return events
    .filter((event) => STAGE_BY_ACTION_STATE[event.to_state] === stage)
    .toSorted((left, right) => left.position - right.position);
}

/**
 * Cómo se nombra un evento ya registrado: por el PAR, con la misma tabla que nombró el botón
 * que lo pidió. Leer "Send it back" donde alguien pulsó "Send it back" es lo que hace que el
 * registro y la pantalla que lo produjo se puedan comparar.
 *
 * Sin `from_state` es la creación de la acción, que ningún botón nombró: ahí sirve el estado.
 */
export function eventLabel(event: Pick<ActionEvent, 'from_state' | 'to_state'>): string {
  return event.from_state
    ? transitionLabel(event.from_state, event.to_state)
    : STATE_LABELS[event.to_state];
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
  /**
   * La etapa que el control a la vista escribiría, y que todavía no ocurrió. El stepper la
   * dibuja como borrador: el formulario que está abajo lleva ahí, y decirlo con el segmento
   * evita que avanzar parezca un salto sin destino. `null` cuando no hay nada que pulsar.
   */
  writes: FindingStage | null;
  /**
   * La acción cuyo compromiso todavía se puede corregir (ADR-018): presente solo mientras
   * el hallazgo está en `assigned` y quien lee puede enmendar. Iniciar el trabajo la
   * retira. Es comodidad: el servidor vuelve a exigirlo.
   */
  amend: ActionSummary | null;
};

const REQUIREMENT_LABELS: Readonly<Record<TransitionRequirement, string>> = {
  not_executor:
    'A verifier other than the person who declared the work done must submit it, unless they are the HS coordinator.',
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
      writes: canCreateAction(session, finding) ? 'assigned' : null,
      amend: null,
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
    writes: allowed ? STAGE_BY_ACTION_STATE[transition.to] : null,
    // Solo en `assigned` —la acción en `open`— y antes de que nadie pulse `Start work`.
    amend: state === 'assigned' && canAmendAssignment(session, finding) ? action : null,
  };
}

/** El nombre de una versión del compromiso en el registro de la etapa Assigned (ADR-018). */
export function commitmentLabel(position: number): string {
  return position === 0 ? 'Original commitment' : `Amendment ${position}`;
}

/**
 * El valor ISO guardado, recortado a lo que espera un `<input type="datetime-local">`.
 *
 * Se recorta la cadena, no se convierte el huso: un plazo se lee y se vuelve a
 * comprometer en la zona en que se guardó, igual que `formatDay` y `formatInstant`.
 */
export function toDateTimeLocal(iso: string): string {
  return iso.slice(0, 16);
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

/** Lo escrito en los tres campos del compromiso, tal como los devuelve el navegador. */
export type CommitmentDraft = {
  assigneePersonId: string;
  description: string;
  dueAt: string;
};

export type CommitmentResult =
  | { success: true; request: CreateActionRequest }
  | { success: false; message: string };

/**
 * Los tres campos del compromiso, comprobados en el orden en que se leen: responsable,
 * plazo, trabajo.
 *
 * **Una sola regla para crear y para enmendar**, que es lo que ADR-018 dice que son: la misma
 * decisión escrita dos veces, una al asignar y otra al corregir. Con la comprobación copiada
 * en cada formulario, la primera vez que discreparan la enmienda aceptaría un compromiso que
 * crear rechaza —o al revés— sin que nada lo delate.
 *
 * **El responsable se comprueba contra el roster** y no solo contra el esquema: `uuid()` no
 * sabe si esa persona sigue activa en esta planta, y el mensaje que corresponde no es «forma
 * inválida», es a quién se puede asignar. Es comodidad, no garantía: el servidor lo vuelve a
 * exigir.
 *
 * `now` entra por parámetro —no hay reloj acá adentro— porque el plazo se compara contra el
 * momento del envío y una función que lo lee sola no se puede probar.
 */
export function commitmentRequest(
  draft: CommitmentDraft,
  roster: readonly PersonOption[],
  now: Date,
): CommitmentResult {
  if (!roster.some((person) => person.id === draft.assigneePersonId)) {
    return { success: false, message: 'Choose an active assignee from this site.' };
  }

  const deadline = futureDueAt(draft.dueAt, now);

  if (!deadline.success) return { success: false, message: deadline.message };

  const request = createActionRequestSchema.safeParse({
    assignee_person_id: draft.assigneePersonId,
    description: draft.description,
    due_at: deadline.dueAt,
  });

  return request.success
    ? { success: true, request: request.data }
    : {
        success: false,
        message: `Description must be between ${ACTION_DESCRIPTION_MIN} and ${ACTION_DESCRIPTION_MAX} characters.`,
      };
}
