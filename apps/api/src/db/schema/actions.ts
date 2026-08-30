import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ActionState, EscalationLevel, EvidenceKind } from '@hs/contracts';

import { site } from './catalog';
import { finding } from './findings';
import { investigation } from './incidents';
import { appUser, person } from './identity';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0011_corrective_actions.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * la guarda de la máquina de estados, la del verificador, la restricción diferida
 * —"una acción sin eventos no existe"—, los triggers de prohibición de
 * UPDATE/DELETE/TRUNCATE, los de
 * auditoría, `hs_apply_site_isolation` y los GRANT. Nada de eso lo sabe expresar un
 * esquema de ORM. Por eso `drizzle-kit generate` está prohibido: regeneraría el
 * `.sql` a partir de esto y se llevaría puesto el mecanismo. Si el SQL cambia, este
 * espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**,
 * igual que en `findings.ts` e `inspections.ts`: 0011 no tiene un solo
 * `GRANT UPDATE`. Avanzar una acción es insertar un evento, no corregir una fila.
 */

/**
 * La acción correctiva (migración 0011). Requisitos §4 y §3 R2, R3.
 *
 * **No hay columna de estado y esa ausencia es el requisito** (ADR-002). El estado
 * vigente es `DISTINCT ON (action_id) ... ORDER BY position DESC` sobre
 * `correctiveActionEvent`; buscar acá un campo `status` es buscar lo que el diseño
 * decidió no tener.
 *
 * `dueAt` queda congelado el día que la acción se crea.
 */
export const correctiveAction = pgTable(
  'corrective_action',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // EXACTAMENTE UN PADRE, que es un hallazgo O una investigación (§4, migración
    // 0012). Las dos columnas son nulables y un `CHECK (num_nonnulls(...) = 1)` en el
    // motor exige que haya una y solo una: ni ninguna —una obligación sin padre no se
    // puede rastrear hasta el hecho que la originó— ni las dos, que dejaría sin
     // respuesta de qué padre originó la obligación.
    //
    // Uno a muchos hacia abajo: un padre puede tener varias acciones, una acción cubre
    // un solo padre (pregunta cerrada 9).
    findingId: uuid('finding_id').references(() => finding.id),

    investigationId: uuid('investigation_id').references(() => investigation.id),

    // Una PERSONA del roster, no una cuenta (§3 R2). Sin par con el sitio: 0005
    // documenta por qué `person` no lleva `UNIQUE (site_id, id)` —`person.siteId` es
    // mutable y una transferencia no puede reescribir el pasado—, así que el sitio del
    // responsable se comprueba al crear la acción.
    assigneePersonId: uuid('assignee_person_id')
      .notNull()
      .references(() => person.id),

    description: text('description').notNull(),

    // Fecha declarada por el coordinador y congelada al crear.
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),

    // La remediación compartida de la pregunta cerrada 9: agrupa en la UI y en
    // reportes, y **no altera plazos, escalamientos ni verificación**. Sin FK porque no
    // es una entidad.
    remediationGroupId: uuid('remediation_group_id'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.findingId, table.siteId],
      foreignColumns: [finding.id, finding.siteId],
    }),
    foreignKey({
      columns: [table.investigationId, table.siteId],
      foreignColumns: [investigation.id, investigation.siteId],
    }),

    // Destino de las FK compuestas de las otras tres tablas del módulo.
    unique('corrective_action_id_site_uq').on(table.id, table.siteId),

    index('corrective_action_due_idx').on(table.siteId, table.dueAt),
    index('corrective_action_finding_idx').on(table.findingId),
    index('corrective_action_investigation_idx').on(table.investigationId),
    index('corrective_action_assignee_idx').on(table.siteId, table.assigneePersonId),
  ],
);

/**
 * El stream de eventos (migración 0011). §4: "el progreso es un stream de eventos,
 * no un campo de estado".
 *
 * `position` es el `seq` de ADR-002, por acción en vez de global: el único
 * `(actionId, position)` es lo que impide que dos transiciones simultáneas partan del
 * mismo estado y bifurquen el stream.
 *
 * `actorUserId` es una CUENTA, mientras que `correctiveAction.assigneePersonId` es una
 * PERSONA. Son dos hechos distintos: de quién era la obligación, y quién tocó el
 * sistema.
 */
export const correctiveActionEvent = pgTable(
  'corrective_action_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    actionId: uuid('action_id')
      .notNull()
      .references(() => correctiveAction.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    position: integer('position').notNull(),

    // Nulo solo en el evento de creación.
    fromState: text('from_state').$type<ActionState>(),

    toState: text('to_state').$type<ActionState>().notNull(),

    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => appUser.id),

    note: text('note'),

    // Obligatorio al rechazar una verificación, y solo ahí.
    reason: text('reason'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.actionId, table.siteId],
      foreignColumns: [correctiveAction.id, correctiveAction.siteId],
    }),

    // La defensa contra la bifurcación del stream, y a la vez el índice que resuelve el
    // `DISTINCT ON` del estado vigente leído al revés. No hay un segundo índice sobre
    // las mismas columnas y esa ausencia es deliberada.
    unique('corrective_action_event_position_uq').on(table.actionId, table.position),

    // Destino de la FK compuesta de la evidencia.
    unique('corrective_action_event_id_site_uq').on(table.id, table.siteId),
  ],
);

/**
 * La evidencia antes/después de R3 (migración 0011).
 *
 * **Cuelga del EVENTO y no de la acción**: sin eso, las fotos de un cierre y las de un
 * cierre anterior rechazado quedarían mezcladas en una sola bolsa. La evidencia es
 * opcional en toda transición (ADR-016).
 */
export const correctiveActionEvidence = pgTable(
  'corrective_action_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    eventId: uuid('event_id')
      .notNull()
      .references(() => correctiveActionEvent.id),

    actionId: uuid('action_id')
      .notNull()
      .references(() => correctiveAction.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    kind: text('kind').$type<EvidenceKind>().notNull(),

    // Una object key del bucket. NUNCA bytes (ADR-001).
    objectKey: text('object_key').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.siteId],
      foreignColumns: [correctiveActionEvent.id, correctiveActionEvent.siteId],
    }),
    foreignKey({
      columns: [table.actionId, table.siteId],
      foreignColumns: [correctiveAction.id, correctiveAction.siteId],
    }),
    uniqueIndex('corrective_action_evidence_key_uq').on(table.eventId, table.objectKey),
    index('corrective_action_evidence_event_idx').on(table.eventId),
  ],
);

/**
 * Los escalamientos ya ocurridos (migración 0011). §3 R3: +3 días al supervisor, +7 a
 * gerencia.
 *
 * **El único `(actionId, level)` es la idempotencia del cron**: el trabajo corre todos
 * los días sobre una acción vencida hace un mes y escala una sola vez por nivel, no
 * porque el handler lleve la cuenta sino porque el segundo INSERT no entra.
 *
 * `dueAt` y `daysOverdue` quedan guardados para que el registro diga cuán tarde era
 * cuando se escaló, no cuán tarde es hoy.
 */
export const correctiveActionEscalation = pgTable(
  'corrective_action_escalation',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    actionId: uuid('action_id')
      .notNull()
      .references(() => correctiveAction.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    level: text('level').$type<EscalationLevel>().notNull(),

    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    daysOverdue: integer('days_overdue').notNull(),

    escalatedAt: timestamp('escalated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.actionId, table.siteId],
      foreignColumns: [correctiveAction.id, correctiveAction.siteId],
    }),
    unique('corrective_action_escalation_level_uq').on(table.actionId, table.level),
  ],
);

export type CorrectiveAction = typeof correctiveAction.$inferSelect;
export type NewCorrectiveAction = typeof correctiveAction.$inferInsert;

export type CorrectiveActionEvent = typeof correctiveActionEvent.$inferSelect;
export type NewCorrectiveActionEvent = typeof correctiveActionEvent.$inferInsert;

export type CorrectiveActionEvidence = typeof correctiveActionEvidence.$inferSelect;
export type NewCorrectiveActionEvidence = typeof correctiveActionEvidence.$inferInsert;

export type CorrectiveActionEscalation = typeof correctiveActionEscalation.$inferSelect;
export type NewCorrectiveActionEscalation = typeof correctiveActionEscalation.$inferInsert;

/**
 * Las enmiendas del compromiso (migración 0041). ADR-018, §7 etapa 4.
 *
 * **`corrective_action` sigue siendo la fila original inmutable.** Cada corrección de
 * responsable, trabajo o plazo hecha mientras la acción está en `open` es una fila nueva
 * acá, con una instantánea completa —nunca un PATCH— y su posición dentro de la acción.
 * La lectura toma la posición más alta y cae a la fila original si no hay ninguna.
 *
 * El SQL lleva además la guarda que solo admite enmiendas mientras el estado derivado es
 * `open`, el único `(action_id, position)` contra la bifurcación del historial, el
 * trigger de auditoría, los de prohibición de UPDATE/DELETE/TRUNCATE, `hs_apply_site_isolation`
 * y los GRANT. Nada de eso lo expresa el ORM; si el SQL cambia, este espejo se actualiza
 * a mano.
 */
export const correctiveActionCommitmentAmendment = pgTable(
  'corrective_action_commitment_amendment',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    actionId: uuid('action_id')
      .notNull()
      .references(() => correctiveAction.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // La fila original es la posición cero conceptual; la primera enmienda es la 1.
    position: integer('position').notNull(),

    assigneePersonId: uuid('assignee_person_id')
      .notNull()
      .references(() => person.id),

    description: text('description').notNull(),

    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),

    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => appUser.id),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.actionId, table.siteId],
      foreignColumns: [correctiveAction.id, correctiveAction.siteId],
    }),

    // La defensa contra la bifurcación del historial, y a la vez el índice del
    // `ORDER BY position DESC` que resuelve el compromiso vigente.
    unique('corrective_action_commitment_amendment_position_uq').on(table.actionId, table.position),
  ],
);

export type CorrectiveActionCommitmentAmendment =
  typeof correctiveActionCommitmentAmendment.$inferSelect;
export type NewCorrectiveActionCommitmentAmendment =
  typeof correctiveActionCommitmentAmendment.$inferInsert;
