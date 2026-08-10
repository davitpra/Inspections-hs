import { z } from 'zod';

import type { Role } from './identity.js';
import { severitySchema, type Severity } from './findings.js';

/**
 * Requisitos §7 etapa 5 — La acción correctiva y su ciclo de vida.
 *
 * De un hallazgo clasificado sale una obligación con una persona nombrada y una
 * fecha límite (§3 R2). El responsable la ejecuta, carga evidencia, y **alguien
 * distinto** la verifica y la cierra (§3 R3). Si vence sin cerrarse, escala.
 *
 * Las dos reglas de este archivo —qué transiciones existen y de dónde sale la
 * fecha límite— son **funciones puras sin base de datos** (ADR-008), y viven acá
 * y no en `packages/forms` por dos motivos: `forms` es el motor de formularios y
 * va dentro del service worker, y la tabla de transiciones es un dato del
 * contrato —el cliente necesita saber qué botón mostrar— no del motor.
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado: que
 * el hallazgo esté clasificado, que la transición salga del estado vigente, que
 * quien verifica no sea quien ejecutó. Eso son triggers en
 * `apps/api/drizzle/0011_corrective_actions.sql`. Zod valida la forma.
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
 * - `after_evidence`: al menos una evidencia `after`. R3, "carga evidencia".
 * - `not_executor`: el actor no puede ser quien declaró el trabajo hecho. R3,
 *   "una persona distinta del ejecutor".
 * - `reason`: hay que decir por qué. Solo al rechazar una verificación.
 */
export const TRANSITION_REQUIREMENTS = ['after_evidence', 'not_executor', 'reason'] as const;

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
 * haya deshecho es un hallazgo nuevo, con su fecha y su clasificación, que es
 * además lo único que la recurrencia de la etapa 7 puede contar.
 *
 * Ser un dato y no código es lo que permite que la UI derive los botones de acá
 * —`TRANSITIONS.filter(...)`— en vez de reimplementar la regla en un `if`, que es
 * la forma en que cliente y servidor terminan discrepando.
 *
 * **La misma tabla está escrita como guarda en la migración 0011** y un test de
 * integración evalúa los 20 pares ordenados por los dos caminos y los compara.
 */
export const TRANSITIONS: readonly ActionTransition[] = [
  { from: null, to: 'open', roles: ['hs_coordinator'], requires: [] },
  { from: 'open', to: 'in_progress', roles: [ASSIGNEE, 'hs_coordinator'], requires: [] },
  {
    from: 'in_progress',
    to: 'awaiting_verification',
    roles: [ASSIGNEE, 'hs_coordinator'],
    requires: ['after_evidence'],
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
// El plazo

/**
 * La fecha límite por severidad, en días.
 *
 * **Configuración en código, no regla legal autoritativa.** Los requisitos fijan
 * el escalamiento en +3 y +7 días (§3 R3) pero no el plazo inicial; estos cinco
 * números los elegimos nosotros y hay que confirmarlos con el coordinador de HS
 * antes de producción. El mismo cartel que §4 le pone a la lista de
 * clasificaciones que obligan investigación.
 *
 * Cambiarlos después es barato y **no reescribe el pasado**: `due_at` queda
 * congelado en cada fila el día que la acción se crea (design D5).
 */
export const DUE_DAYS_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  catastrophic: 3,
  major: 7,
  moderate: 14,
  minor: 30,
  negligible: 60,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * La fecha límite de una acción.
 *
 * Deriva de la **severidad** y no del `risk_level`, porque §3 R2 dice
 * literalmente "una fecha límite derivada de la severidad". El nivel de riesgo
 * sirve para priorizar y para reportar; el plazo es de la severidad.
 *
 * **Se calcula acá y no en SQL**, a diferencia de la matriz de riesgo de 0010.
 * `timestamptz + interval 'N days'` de Postgres suma días de calendario según la
 * zona de la sesión, así que las dos implementaciones diferirían en una hora
 * cuatro veces al año y ningún test lo notaría hasta marzo. Con una sola
 * implementación no hay nada que comparar: el servidor calcula y el `INSERT`
 * lleva el valor ya resuelto.
 */
export function dueAt(severity: Severity, from: Date): Date {
  return new Date(from.getTime() + DUE_DAYS_BY_SEVERITY[severity] * MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// El escalamiento

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
 * Crear una acción.
 *
 * **`due_at` y `severity` no están, y esa ausencia es el requisito.** Los calcula
 * el servidor a partir de la clasificación vigente del hallazgo: un plazo que el
 * caller pudiera mandar sería un plazo negociable, y el registro dejaría de poder
 * decir qué se prometió el día que se prometió.
 *
 * `remediation_group_id` es la remediación compartida de la pregunta cerrada 9:
 * **opcional y sin semántica**. Agrupa en la UI y en reportes; no altera plazos,
 * escalamientos ni verificación, y cada acción del grupo se cierra sola.
 */
export const createActionRequestSchema = z.strictObject({
  assignee_person_id: z.uuid(),
  description: z.string().trim().min(ACTION_DESCRIPTION_MIN).max(ACTION_DESCRIPTION_MAX),
  remediation_group_id: z.uuid().optional(),
});

export type CreateActionRequest = z.infer<typeof createActionRequestSchema>;

/** De qué momento del trabajo es una evidencia. R3 pide antes/después. */
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
 * Los dos `refine` reproducen las dos filas de `TRANSITIONS` que exigen algo:
 * `after_evidence` al declarar el trabajo hecho, y `reason` al rechazar una
 * verificación. Son la primera barrera y la más barata —el cliente ni siquiera
 * manda el request—; la segunda es el servicio y la tercera son los `CHECK` y
 * los triggers de 0011.
 *
 * `from` no viaja: el servidor ya sabe cuál es el estado vigente, y aceptarlo del
 * caller sería dejarle elegir contra qué se valida.
 */
export const transitionRequestSchema = z
  .strictObject({
    to: actionStateSchema,
    note: z.string().trim().min(1).max(2000).optional(),
    reason: z.string().trim().min(10).max(2000).optional(),
    evidence: z.array(evidenceInputSchema).max(10).default([]),
  })
  .refine(
    (value) =>
      value.to !== 'awaiting_verification' || value.evidence.some((item) => item.kind === 'after'),
    {
      message: 'Declarar el trabajo hecho exige al menos una evidencia `after`.',
      path: ['evidence'],
    },
  );

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

/**
 * Una acción correctiva tal como la devuelve la API.
 *
 * **`state` viene de los eventos, no de una columna** (ADR-002): la tabla
 * `corrective_action` no tiene dónde guardarlo. `overdue` se calcula comparando
 * `due_at` con el reloj del servidor al leer, por el mismo motivo.
 *
 * `severity` es la que tenía el hallazgo **el día que se creó la acción**, que es
 * de la que salió `due_at`. Reclasificar el hallazgo después no mueve ninguna de
 * las dos (design D5).
 */
export const actionSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  finding_id: z.uuid(),
  assignee_person_id: z.uuid(),
  description: z.string(),
  severity: severitySchema,
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

export const actionListSchema = z.array(actionSchema);

export type ActionList = z.infer<typeof actionListSchema>;

/**
 * Los roles que pueden verificar, **derivados de `TRANSITIONS`** y no escritos otra
 * vez: una segunda lista es una lista que puede quedar desactualizada.
 */
export const VERIFIER_ROLES: readonly Role[] = [
  ...new Set(transitionsFrom('awaiting_verification').flatMap((transition) => transition.roles)),
].filter((actor): actor is Role => actor !== ASSIGNEE);
