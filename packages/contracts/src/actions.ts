import { z } from 'zod';

import type { Role } from './identity.js';

/**
 * Requisitos §7 etapa 5 — La acción correctiva y su ciclo de vida.
 *
 * De un hallazgo sale una obligación con una persona nombrada y una fecha límite
 * (§3 R2). El responsable la ejecuta, el sistema pide y conserva evidencia opcional,
 * y **alguien distinto** la verifica y la cierra (§3 R3, ADR-016). Si vence sin
 * cerrarse, escala.
 *
 * La regla de este archivo —qué transiciones existen— es una **función pura sin
 * base de datos** (ADR-008), y vive acá y no en `packages/forms` por dos motivos:
 * `forms` es el motor de formularios y va dentro del service worker, y la tabla
 * de transiciones es un dato del contrato —el cliente necesita saber qué botón
 * mostrar— no del motor.
 *
 * **La fecha límite ya no se calcula.** Salía de la severidad de la clasificación
 * del hallazgo, retirada antes de producción (ADR-014); ahora la declara el
 * coordinador al abrir la acción. Que esa fecha sea futura depende del reloj, así
 * que no se comprueba acá: este archivo no lo lee (ADR-007).
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado: que
 * la transición salga del estado vigente, que quien verifica no sea quien
 * ejecutó. Eso son triggers en `apps/api/drizzle/0011_corrective_actions.sql`.
 * Zod valida la forma.
 */

/** La misma forma que en `findings.ts`: una key del bucket, nunca bytes (ADR-001). */
const objectKeySchema = z.string().min(1).max(512);

// ---------------------------------------------------------------------------
// Los estados

/**
 * Los cuatro estados de §4, y no hay un quinto.
 *
 * **`overdue` no está y esa ausencia es deliberada**: que una acción esté vencida
 * es una comparación entre `due_at` y el reloj, no un estado por el que la acción
 * pasa. Si lo fuera, una acción vencida perdería la información de si estaba en
 * progreso o esperando verificación, que es justo lo que el supervisor que recibe
 * el escalamiento necesita saber.
 *
 * **La misma lista está escrita como `CHECK` en la migración 0011** y un test de
 * integración las compara. SQL no puede importar TypeScript; la duplicación es
 * deliberada y está bajo prueba, igual que la de `RESPONSE_TYPES` en 0007.
 */
export const ACTION_STATES = ['open', 'in_progress', 'awaiting_verification', 'closed'] as const;

export const actionStateSchema = z.enum(ACTION_STATES);

export type ActionState = z.infer<typeof actionStateSchema>;

// ---------------------------------------------------------------------------
// La máquina de estados, como tabla de datos

/**
 * Quién puede hacer una transición.
 *
 * `assignee` **no es un rol de `ROLES`**: es una posición relativa a la acción
 * —«la cuenta de la persona responsable de ESTA acción»— y se resuelve en el
 * servicio contra `app_user.person_id`, no contra `app_user.role`. Está en la
 * misma lista porque las cinco filas de `TRANSITIONS` son la respuesta completa a
 * "quién puede hacer qué", y partirla en dos tablas haría que se pueda leer una
 * sin la otra.
 */
export const ASSIGNEE = 'assignee' as const;

export type TransitionActor = Role | typeof ASSIGNEE;

/**
 * Lo que una transición exige además del estado de origen.
 *
 * - `not_executor`: el actor no puede ser quien declaró el trabajo hecho. R3,
 *   "una persona distinta del ejecutor" — **salvo el `hs_coordinator`, que está
 *   exento** (ADR-019): es la única cuenta que declara trabajo hecho por una
 *   persona del roster sin usuario, y aplicarle la regla dejaba trabajo
 *   terminado retenido en `awaiting_verification`. Sigue entera para
 *   `supervisor` y `management`.
 * - `reason`: hay que decir por qué. Solo al rechazar una verificación.
 *
 * QUIÉN SUFRE `not_executor` NO SE LEE DE ACÁ, igual que `ASSIGNEE` no dice
 * quién es: la fila declara la condición y la excepción se resuelve donde se
 * conoce la cuenta —`ActionsService.transition` y la guarda `HS005` del motor—.
 * Partirla en dos requisitos obligaría al cliente a elegir cuál aplica, y el
 * cliente no evalúa ninguno de los dos a propósito.
 */
export const TRANSITION_REQUIREMENTS = ['not_executor', 'reason'] as const;

export type TransitionRequirement = (typeof TRANSITION_REQUIREMENTS)[number];

export interface ActionTransition {
  /** `null` es la creación: la acción todavía no existía. */
  readonly from: ActionState | null;
  readonly to: ActionState;
  readonly roles: readonly TransitionActor[];
  readonly requires: readonly TransitionRequirement[];
}

/**
 * **La máquina de estados, como dato y no como `switch`.**
 *
 * Cinco filas y ninguna más. Todo par que no esté acá se rechaza, y `closed` no
 * aparece nunca como `from`: es terminal (design D14). Que el trabajo cerrado se
 * haya deshecho es un hallazgo nuevo, con su propia fecha, y no una reapertura
 * del anterior.
 *
 * Ser un dato y no código es lo que permite que la UI derive los botones de acá
 * —`TRANSITIONS.filter(...)`— en vez de reimplementar la regla en un `if`, que es
 * la forma en que cliente y servidor terminan discrepando.
 *
 * **La misma tabla está escrita como guarda en la migración 0011** y un test de
 * integración evalúa los 20 pares ordenados por los dos caminos y los compara.
 *
 * **La creación escribe solamente la primera fila**. `open → in_progress` sigue siendo
 * la declaración explícita de que el trabajo empezó; no congela la asignación, que puede
 * corregirse hasta `closed` (ADR-020).
 */
export const TRANSITIONS: readonly ActionTransition[] = [
  { from: null, to: 'open', roles: ['hs_coordinator'], requires: [] },
  { from: 'open', to: 'in_progress', roles: [ASSIGNEE, 'hs_coordinator'], requires: [] },
  {
    from: 'in_progress',
    to: 'awaiting_verification',
    roles: [ASSIGNEE, 'hs_coordinator'],
    requires: [],
  },
  {
    from: 'awaiting_verification',
    to: 'closed',
    roles: ['hs_coordinator', 'supervisor', 'management'],
    requires: ['not_executor'],
  },
  {
    from: 'awaiting_verification',
    to: 'in_progress',
    roles: ['hs_coordinator', 'supervisor', 'management'],
    requires: ['not_executor', 'reason'],
  },
] as const;

/**
 * La transición de un par, o `undefined` si la máquina no la permite.
 *
 * Consulta la tabla; no la reimplementa. Un `switch` acá sería una segunda copia
 * de la regla que podría divergir de `TRANSITIONS` sin que nada se queje.
 */
export function transitionFor(
  from: ActionState | null,
  to: ActionState,
): ActionTransition | undefined {
  return TRANSITIONS.find((transition) => transition.from === from && transition.to === to);
}

/** Las transiciones disponibles desde un estado. Lo que la UI usa para los botones. */
export function transitionsFrom(from: ActionState | null): readonly ActionTransition[] {
  return TRANSITIONS.filter((transition) => transition.from === from);
}

// ---------------------------------------------------------------------------
// El escalamiento

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Los dos escalones de §3 R3, y los días de atraso que los disparan.
 *
 * El orden es significativo: el cron los recorre de menor a mayor.
 */
export const ESCALATION_LEVELS = ['supervisor', 'management'] as const;

export const escalationLevelSchema = z.enum(ESCALATION_LEVELS);

export type EscalationLevel = z.infer<typeof escalationLevelSchema>;

/** +3 días al supervisor, +7 días a gerencia. ADR-005 lo nombra con estos números. */
export const ESCALATION_DAYS: Readonly<Record<EscalationLevel, number>> = {
  supervisor: 3,
  management: 7,
};

/** Qué rol recibe cada escalón (§4, tabla de roles: "Gerencia recibe escalamientos"). */
export const ESCALATION_RECIPIENT_ROLE: Readonly<Record<EscalationLevel, Role>> = {
  supervisor: 'supervisor',
  management: 'management',
};

/**
 * Los escalones que una acción vencida ya alcanzó, dado el atraso.
 *
 * Puro y con el reloj inyectado: el cron le pasa el `now` de su payload, y el
 * test no necesita mover el reloj del proceso.
 */
export function escalationLevelsDue(dueAtValue: Date, now: Date): readonly EscalationLevel[] {
  const daysOverdue = (now.getTime() - dueAtValue.getTime()) / MS_PER_DAY;

  return ESCALATION_LEVELS.filter((level) => daysOverdue > ESCALATION_DAYS[level]);
}

// ---------------------------------------------------------------------------
// Lo que se escribe

export const ACTION_DESCRIPTION_MIN = 10;
export const ACTION_DESCRIPTION_MAX = 2000;

/**
 * Crear una acción, cuelgue de un hallazgo o de una investigación.
 *
 * **Es un solo esquema para los dos padres.** Hubo dos mientras la fecha límite
 * salía de la severidad: un hallazgo la tenía en su clasificación y una
 * investigación no, así que el segundo cuerpo pedía `severity`. Retirada la
 * clasificación (ADR-014), los dos cuerpos son el mismo y el padre sigue donde
 * siempre estuvo: en la RUTA, no en un campo. §4 fija que una acción pertenece a
 * exactamente un padre, y un `investigation_id` opcional acá dejaría esa relación
 * como un campo más.
 *
 * **`due_at` viaja y es obligatorio.** Ya no hay nada de donde derivarlo: la
 * fecha es lo que el coordinador se compromete a cumplir. Que sea futura lo
 * comprueba el servicio, que sí tiene reloj; acá solo se valida la forma.
 *
 * `remediation_group_id` es la remediación compartida de la pregunta cerrada 9:
 * **opcional y sin semántica**. Agrupa en la UI y en reportes; no altera plazos,
 * escalamientos ni verificación, y cada acción del grupo se cierra sola.
 */
export const createActionRequestSchema = z.strictObject({
  assignee_person_id: z.uuid(),
  description: z.string().trim().min(ACTION_DESCRIPTION_MIN).max(ACTION_DESCRIPTION_MAX),
  due_at: z.iso.datetime({ offset: true }),
  remediation_group_id: z.uuid().optional(),
});

export type CreateActionRequest = z.infer<typeof createActionRequestSchema>;

/** Reemplazo completo de la asignación vigente mientras la acción no esté cerrada (ADR-020). */
export const replaceActionAssignmentRequestSchema = createActionRequestSchema.omit({
  remediation_group_id: true,
});

export type ReplaceActionAssignmentRequest = z.infer<typeof replaceActionAssignmentRequestSchema>;

/** De qué momento del trabajo es una evidencia. R3 pide y conserva antes/después (ADR-016). */
export const EVIDENCE_KINDS = ['before', 'after'] as const;

export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);

export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

/** Una evidencia: la key del objeto ya subido, nunca los bytes (ADR-001, ADR-006). */
export const evidenceInputSchema = z.strictObject({
  kind: evidenceKindSchema,
  object_key: objectKeySchema,
});

export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

/**
 * Pedir una transición.
 *
 * La evidencia es opcional en toda transición (ADR-016). El objeto sigue siendo
 * estricto y limita la cantidad de keys que el cliente puede mandar.
 *
 * `from` no viaja: el servidor ya sabe cuál es el estado vigente, y aceptarlo del
 * caller sería dejarle elegir contra qué se valida.
 */
export const transitionRequestSchema = z.strictObject({
  to: actionStateSchema,
  note: z.string().trim().min(1).max(2000).optional(),
  reason: z.string().trim().min(10).max(2000).optional(),
  evidence: z.array(evidenceInputSchema).max(10).default([]),
});

// El `reason` obligatorio del rechazo de una verificación NO se puede exigir acá:
// `awaiting_verification → in_progress` lo necesita y `open → in_progress` no, y
// este request no lleva `from` con el que distinguirlos. La regla se cierra en el
// servicio, que ya leyó el estado vigente, y en el `CHECK` de la migración 0011.

export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

// ---------------------------------------------------------------------------
// Lo que se lee

/** Una evidencia, tal como se lee. */
export const evidenceSchema = z.strictObject({
  id: z.uuid(),
  kind: evidenceKindSchema,
  object_key: objectKeySchema,
  created_at: z.iso.datetime({ offset: true }),
});

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Un evento del stream.
 *
 * `position` es el orden dentro de la acción y es lo que hace que el estado
 * vigente sea una consulta —`DISTINCT ON ... ORDER BY position DESC`— y no una
 * columna (ADR-002, design D1).
 */
export const actionEventSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(0),
  from_state: actionStateSchema.nullable(),
  to_state: actionStateSchema,
  actor_user_id: z.uuid(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
  recorded_at: z.iso.datetime({ offset: true }),
  evidence: z.array(evidenceSchema),
});

export type ActionEvent = z.infer<typeof actionEventSchema>;

/** Un escalamiento ya ocurrido. Un hecho sobre la acción, no un paso de su ciclo. */
export const actionEscalationSchema = z.strictObject({
  level: escalationLevelSchema,
  days_overdue: z.number().int().min(0),
  escalated_at: z.iso.datetime({ offset: true }),
});

export type ActionEscalation = z.infer<typeof actionEscalationSchema>;

/** El hallazgo de inspección conserva la identidad estable de su plantilla. */
export const inspectionActionSourceSchema = z.strictObject({
  kind: z.literal('inspection'),
  finding_id: z.uuid(),
  inspection_id: z.uuid(),
  scheduled_inspection_id: z.uuid(),
  template_id: z.uuid(),
  template_name: z.string().min(1),
});

export const manualFindingActionSourceSchema = z.strictObject({
  kind: z.literal('manual_finding'),
  finding_id: z.uuid(),
});

export const investigationActionSourceSchema = z.strictObject({
  kind: z.literal('investigation'),
  investigation_id: z.uuid(),
});

export const actionSourceSchema = z.discriminatedUnion('kind', [
  inspectionActionSourceSchema,
  manualFindingActionSourceSchema,
  investigationActionSourceSchema,
]);

export type ActionSource = z.infer<typeof actionSourceSchema>;

/** Una fila operativa del listado, sin afirmar que trae el stream de eventos. */
export const actionSummarySchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  site_name: z.string().min(1),
  assignee_person_id: z.uuid(),
  assignee_name: z.string().min(1).nullable(),
  description: z.string(),
  due_at: z.iso.datetime({ offset: true }),
  state: actionStateSchema,
  overdue: z.boolean(),
  escalations: z.array(actionEscalationSchema),
  source: actionSourceSchema,
});

export type ActionSummary = z.infer<typeof actionSummarySchema>;

/**
 * Una acción correctiva tal como la devuelve la API.
 *
 * **`state` viene de los eventos, no de una columna** (ADR-002): la tabla
 * `corrective_action` no tiene dónde guardarlo. `overdue` se calcula comparando
 * `due_at` con el reloj del servidor al leer, por el mismo motivo.
 *
 * Los tres campos de asignación son los valores vigentes de la única fila. El motor permite
 * corregirlos hasta que el estado derivado llega a `closed`, y los congela desde ahí (ADR-020).
 *
 * **`finding_id` e `investigation_id` son los dos nulables y exactamente uno es no
 * nulo** (§4, etapa 6): una acción cuelga de un hallazgo o de una investigación, nunca
 * de las dos ni de ninguna.
 */
export const actionSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  /** Exactamente uno de los dos es no nulo; el `CHECK` de 0012 lo garantiza. */
  finding_id: z.uuid().nullable(),
  investigation_id: z.uuid().nullable(),
  assignee_person_id: z.uuid(),
  description: z.string(),
  due_at: z.iso.datetime({ offset: true }),
  remediation_group_id: z.uuid().nullable(),
  created_by: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  /** Derivado del último evento. No existe como columna. */
  state: actionStateSchema,
  /** Derivado de `due_at` y del reloj. Tampoco existe como columna. */
  overdue: z.boolean(),
  events: z.array(actionEventSchema),
  escalations: z.array(actionEscalationSchema),
});

export type Action = z.infer<typeof actionSchema>;

export const actionListSchema = z.array(actionSummarySchema);

export type ActionList = z.infer<typeof actionListSchema>;

/**
 * Los roles que pueden verificar, **derivados de `TRANSITIONS`** y no escritos otra
 * vez: una segunda lista es una lista que puede quedar desactualizada.
 */
export const VERIFIER_ROLES: readonly Role[] = [
  ...new Set(transitionsFrom('awaiting_verification').flatMap((transition) => transition.roles)),
].filter((actor): actor is Role => actor !== ASSIGNEE);
