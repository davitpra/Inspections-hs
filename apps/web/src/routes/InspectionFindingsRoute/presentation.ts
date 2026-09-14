import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  createActionRequestSchema,
  FINDING_STATES,
  isAssignmentEditable,
  transitionsFrom,
  type ActionEvent,
  type ActionState,
  type ActionSummary,
  type ActionTransition,
  type CreateActionRequest,
  type Evidence,
  type Finding,
  type FindingState,
  type PersonOption,
  type Session,
} from '@hs/contracts';
import {
  evaluateVisibility,
  sectionsInDocumentOrder,
  type AnswerSet,
  type TemplateDocument,
  type TemplateItem,
  type TemplateSection,
} from '@hs/forms';

import { canAttempt, canCreateAction, canEditAssignment } from '../../permissions/actions';
import { transitionLabel, transitionTakesNote } from '../../presentation/actions';
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

/**
 * Qué etapas se LEEN juntas, que no es lo mismo que en qué etapa cae cada estado.
 *
 * `In progress` y `Verification` son un solo hilo: declarar el trabajo hecho, devolverlo con un
 * motivo, volver a declararlo. Repartido en dos paneles, cada mitad queda sin la otra —los
 * motivos sin la declaración que los provocó, las declaraciones sin el rechazo que las siguió— y
 * el orden en que ocurrió todo hay que reconstruirlo saltando de pestaña.
 *
 * **ES UNA TABLA APARTE Y NO UN `STAGE_BY_ACTION_STATE` MÁS ANCHO.** Mapear
 * `awaiting_verification` a `in_progress` allá fundiría las dos etapas en todas partes: en la
 * tira, en la etapa vigente y en el plazo que la retiene. Lo que se funde es la lectura, y esa
 * es la única tabla que lo dice.
 *
 * `Closed` queda afuera a propósito: el cierre es la decisión sobre el hilo, no un mensaje más
 * dentro de él, y arrastra su propia galería de evidencia aceptada.
 */
export const STAGES_READ_TOGETHER: Readonly<Record<FindingStage, readonly FindingStage[]>> = {
  raised: ['raised'],
  assigned: ['assigned'],
  in_progress: ['in_progress', 'verification'],
  verification: ['in_progress', 'verification'],
  closed: ['closed'],
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

export type StageStatus = 'done' | 'current' | 'complete' | 'todo';

/**
 * Qué dibuja un segmento con respecto a la etapa vigente.
 *
 * **LA ETAPA TERMINAL ALCANZADA ES UN ESTADO PROPIO Y NO `current`**, porque el color de la
 * etapa vigente dice «acá está el trabajo» y en `closed` no queda trabajo: leído en el mismo
 * azul que `In progress`, el ciclo cerrado promete algo pendiente que no existe. Tampoco es
 * `done`, que son las etapas que quedaron atrás: el hallazgo está en ella, y eso lo sigue
 * diciendo `aria-current`.
 */
export function stageStatus(stage: FindingStage, current: FindingStage): StageStatus {
  const distance = FINDING_STAGES.indexOf(stage) - FINDING_STAGES.indexOf(current);

  if (distance < 0) return 'done';
  if (distance > 0) return 'todo';
  return stage === 'closed' ? 'complete' : 'current';
}

/**
 * Las etapas que se pueden abrir: las alcanzadas, más la que una composición desplegada
 * escribiría.
 *
 * **UN FORMULARIO SE LEE EN LA ETAPA DESDE LA QUE SE EJECUTA**, no en la que escribiría.
 * `Start work` se pulsa estando en `assigned` y por eso se lee ahí, junto al compromiso que
 * ese mismo botón va a poner en marcha. Llegó a leerse en la etapa DESTINO —bajo `In
 * progress`, que todavía no había ocurrido—, y el precio era que el registro que acompaña al
 * paso salía vacío en las tres etapas donde hay algo decidido, con lo decidido escondido una
 * pestaña atrás.
 *
 * **LA ÚNICA EXCEPCIÓN ES EL ALTA DESPLEGADA**, y es excepción porque ahí no hay ninguna etapa
 * anterior con algo escrito que el formulario esté tapando: un hallazgo levantado no tiene
 * compromiso, ni eventos, ni plazo. `Assigned` se ofrece entonces vacía y diciéndolo, que es
 * distinto de prometer una lectura que no existe.
 *
 * `draft` NO sale del paso —`FindingNextStep` no declara qué etapa escribiría—, sale del ciclo:
 * la excepción la produce que alguien haya desplegado la composición, no la tabla de
 * transiciones. Sin borrador, `stageStatus` decide sola, y es la misma que decide si hay
 * registro que dibujar.
 */
export function openableStages(
  current: FindingStage,
  draft: FindingStage | null,
): FindingStage[] {
  return FINDING_STAGES.filter(
    (stage) => stageStatus(stage, current) !== 'todo' || stage === draft,
  );
}

/**
 * Los eventos que se LEEN al abrir esta etapa, en el orden del stream.
 *
 * No son los que la escribieron: `STAGES_READ_TOGETHER` decide de qué etapas viene el hilo, y
 * abrir `In progress` o `Verification` devuelve la misma lista. Por eso el nombre habla de leer
 * y no de escribir.
 *
 * Se ordena por `position` y no por `occurred_at`: el orden dentro de la acción es el que el
 * servidor conserva (design D1), y dos eventos del mismo segundo no pueden quedar dados
 * vuelta por el reloj. Con las dos etapas juntas eso pesa más que antes: la alternancia entre
 * declarar y devolver ES lo que se está leyendo.
 */
export function eventsReadInStage(
  events: readonly ActionEvent[],
  stage: FindingStage,
): ActionEvent[] {
  const thread = STAGES_READ_TOGETHER[stage];

  return events
    .filter((event) => thread.includes(STAGE_BY_ACTION_STATE[event.to_state]))
    .toSorted((left, right) => left.position - right.position);
}

export type AcceptedClosureEvidence = {
  closureId: string;
  evidence: readonly Evidence[];
};

/**
 * La evidencia declarada en el paso que cada cierre aceptó.
 *
 * Se ordena por `position` antes de emparejar: el arreglo puede venir en cualquier orden, pero
 * un cierre solo acepta la declaración que lo precede inmediatamente en el stream. Así, una
 * declaración seguida de un rechazo nunca puede aportar fotos a un cierre posterior.
 */
export function acceptedClosureEvidence(
  events: readonly ActionEvent[],
): AcceptedClosureEvidence[] {
  const ordered = events.toSorted((left, right) => left.position - right.position);

  return ordered.flatMap((event, index) => {
    if (event.to_state !== 'closed') return [];

    const declaration = ordered[index - 1];

    return declaration?.to_state === 'awaiting_verification'
      ? [{ closureId: event.id, evidence: declaration.evidence }]
      : [{ closureId: event.id, evidence: [] }];
  });
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
  control: { kind: 'create' } | { kind: 'progress'; action: ActionSummary } | null;
  /** La persona nombrada cuando el lector no puede intentar el paso. */
  waitingOn?: string | null;
  /**
   * La acción cuya asignación todavía se puede corregir (ADR-021).
   *
   * **Se decide sobre el estado de la ACCIÓN, no sobre la etapa del hallazgo**, y con la
   * misma lista que aplica el servidor: lo que se congela es la fila de la acción, y una
   * etapa nombrada acá sería una segunda tabla que puede separarse de aquella. Declarar el
   * trabajo hecho la retira; el rechazo de la verificación la devuelve.
   */
  editableAssignment: ActionSummary | null;
};

/**
 * El único acto principal que sigue, consultado en la misma tabla que aplica el servidor.
 * `null` significa que todas las acciones están cerradas y no existe reapertura.
 *
 * La rama `raised` necesita el hallazgo, y no solo la sesión: desde ADR-017 y ADR-025 quien lo
 * puede abrir es una cuenta administrativa o la cuenta que reportó ESE hallazgo.
 */
export function nextStep(
  actions: readonly ActionSummary[],
  state: FindingState,
  session: Session | null,
  finding: Pick<Finding, 'reported_by'>,
): FindingNextStep | null {
  if (state === 'raised') {
    return {
      label: 'Create follow-up',
      control: canCreateAction(session, finding) ? { kind: 'create' } : null,
      editableAssignment: null,
    };
  }

  const action = blockingActions(actions, state)[0];
  if (!action) return null;

  const transitions = transitionsFrom(action.state);
  const allowed = transitions.find((transition) => canAttempt(transition, action, session, finding));
  const transition = allowed ?? transitions[0];

  if (!transition) return null;

  return {
    label: transitionLabel(action.state, transition.to),
    control: allowed ? { kind: 'progress', action } : null,
    ...(allowed ? {} : { waitingOn: action.assignee_name }),
    editableAssignment:
      isAssignmentEditable(action.state) && canEditAssignment(session, finding) ? action : null,
  };
}

/** Los campos que ESTA salida escribe. */
export type StepFields = { evidence: boolean; reason: boolean; note: boolean };

/** Una salida del paso: el estado al que lleva, el texto del botón y lo que escribe. */
export type StepChoice = { to: ActionState; label: string; fields: StepFields };

/**
 * Qué pide y qué ofrece el paso de avance, ya recortado a lo que ESTA cuenta puede pedir.
 *
 * Las salidas van en el orden de `TRANSITIONS`; la primera de `choices` es la principal y se
 * dibuja como `button--primary`.
 */
export type StepForm = {
  /** Los campos a la vista: los de las salidas que se ejecutan de una pulsación. */
  fields: StepFields;
  /** Las salidas de una sola pulsación. */
  choices: StepChoice[];
  /** Las salidas que exigen algo escrito: se ofrecen plegadas, con sus propios campos. */
  folded: StepChoice[];
};

/** Lo que una transición escribe, leído de su fila y de `transitionTakesNote`. */
function stepFields(from: ActionState, transition: ActionTransition): StepFields {
  return {
    evidence: transition.to === 'awaiting_verification',
    reason: transition.requires.includes('reason'),
    note: transitionTakesNote(from, transition.to),
  };
}

/**
 * Lo que el formulario del paso muestra, ETAPA POR ETAPA. `null` cuando no queda ninguna
 * transición que esta cuenta pueda pedir: no hay formulario, hay que decir que espera a otro.
 *
 * | etapa        | acción en               | a la vista                               | plegada                     |
 * | ------------ | ----------------------- | ---------------------------------------- | --------------------------- |
 * | Assigned     | `open`                  | ningún campo · Start work                | —                           |
 * | In progress  | `in_progress`           | evidencia + nota · Declare the work done | —                           |
 * | Verification | `awaiting_verification` | nota · Verify and close                  | Send it back → razón + nota |
 *
 * Y por qué cada uno:
 *
 * - **La evidencia acompaña a lo que va a verificarse**, así que se pide en la transición
 *   que entra a `awaiting_verification` y en ninguna otra: es el momento en que alguien
 *   distinto va a mirar el trabajo, y las fotos son lo que va a mirar.
 * - **La razón solo la exige el rechazo**, y no porque lo diga esta tabla: sale de
 *   `requires: ['reason']` en la fila de `TRANSITIONS`, la misma que aplica el servidor.
 * - **La nota la admite todo menos empezar el trabajo** (`transitionTakesNote`): ese paso se
 *   anuncia como "No additional information is required", y un campo debajo la desmiente.
 *
 * **LOS CAMPOS PERTENECEN A LA SALIDA, y por eso la que exige algo escrito se pliega.** Una
 * transición con `requires: ['reason']` no se puede ejecutar de una pulsación, y su campo
 * obligatorio a la vista miente sobre las salidas que no lo piden: en Verification, `Reason`
 * quedaba rotulando `Verify and close`, que no lo usa. Se pliega la que exige, no "la segunda"
 * ni "la de Verification" —una transición futura que pida una razón se pliega sola—, y las
 * demás siguen a la vista porque revelarlas costaría dos pulsaciones para el único acto que la
 * pantalla propone (la misma asimetría de `FindingAssignmentEditor`).
 *
 * ES UNA LECTURA DE `TRANSITIONS`, NO UNA SEGUNDA TABLA. Las respuestas se derivan de lo que ya
 * trae cada fila —a dónde va, qué exige— más `transitionTakesNote`, que es vocabulario. Escrita
 * como `switch` por etapa sería la máquina de estados copiada en la UI, que es la forma en que
 * cliente y servidor empiezan a discrepar (ADR-008).
 *
 * Aparte del componente porque es una decisión: "en Verification se ofrece una salida plegada
 * que pide una razón" se comprueba sin renderizar, o no lo comprueba nadie.
 */
export function stepForm(
  from: ActionState,
  available: readonly ActionTransition[],
): StepForm | null {
  if (available.length === 0) return null;

  const choices = available.map((transition) => ({
    to: transition.to,
    label: transitionLabel(from, transition.to),
    fields: stepFields(from, transition),
  }));

  const inline = choices.filter((choice) => !choice.fields.reason);

  return {
    fields: {
      evidence: inline.some((choice) => choice.fields.evidence),
      // A la vista no hay razón por construcción: la salida que la exige está plegada.
      reason: false,
      note: inline.some((choice) => choice.fields.note),
    },
    choices: inline,
    folded: choices.filter((choice) => choice.fields.reason),
  };
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
 * **Una sola regla para crear y para editar**, que es lo que ADR-021 conserva: la misma
 * decisión escrita dos veces, una al asignar y otra al corregir. Con la comprobación copiada
 * en cada formulario, la primera vez que discreparan la edición aceptaría un compromiso que
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
