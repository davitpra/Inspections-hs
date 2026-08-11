import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  BodyPart,
  IncidentClassification,
  IncidentState,
  InvestigationMethod,
  NarrativeLanguage,
  OnSiteTreatment,
} from '@hs/contracts';

import { location, site } from './catalog';
import { appUser, person } from './identity';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0012_incidents.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * la guarda de la máquina de estados, la de investigación obligatoria, la de causa
 * raíz, la de «no se cierra con acciones abiertas», las dos restricciones diferidas
 * —«un incidente sin evento de reporte no existe» y «un incidente en investigación
 * tiene su investigación»—, los triggers de prohibición de UPDATE/DELETE/TRUNCATE,
 * los de auditoría, `hs_apply_site_isolation`, **la política `RESTRICTIVE` de
 * visibilidad** y los GRANT. Nada de eso lo sabe expresar un esquema de ORM. Por eso
 * `drizzle-kit generate` está prohibido: regeneraría el `.sql` a partir de esto y se
 * llevaría puesto el mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**,
 * igual que en `findings.ts`, `inspections.ts` y `actions.ts`: 0012 no tiene un solo
 * `GRANT UPDATE`. Corregir un incidente es reportar otro, hasta que exista
 * `RegistroSuplementario`.
 */

/**
 * El incidente en tercera persona (migración 0012). Requisitos §4 y §3 R4.
 *
 * **No hay columna de estado ni de plazo regulatorio, y esas dos ausencias son el
 * requisito** (ADR-002, ADR-008). El estado vigente es
 * `DISTINCT ON (incident_id) ... ORDER BY position DESC` sobre `incidentEvent`; los
 * relojes son `regulatoryClocks()` de `@hs/contracts` sobre `classification`,
 * `occurredAt` y `reportedAt`, que están congelados en la fila.
 *
 * **Tampoco hay ninguna columna de detalle clínico, y eso es una prohibición**:
 * `bodyPart` es una categoría gruesa y es el límite (§4, riesgo G-bis).
 *
 * `subjectPersonId` es una PERSONA del roster —que casi seguro no tiene cuenta— y
 * `reportedBy` es una CUENTA. Es la distinción central de §4 en su caso más visible.
 */
export const incident = pgTable(
  'incident',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // La versión del formulario con la que se escribió esta fila (pregunta cerrada 10).
    // `INCIDENT_FORM_VERSIONS` en `@hs/contracts` dice qué campos tenía cada una.
    formVersion: integer('form_version').notNull(),

    classification: text('classification').$type<IncidentClassification>().notNull(),

    // Sin par con el sitio: 0005 documenta por qué `person` no lleva
    // `UNIQUE (site_id, id)` —`person.siteId` es mutable y una transferencia no puede
    // reescribir el pasado—, así que el sitio del sujeto se comprueba al reportar.
    subjectPersonId: uuid('subject_person_id')
      .notNull()
      .references(() => person.id),

    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => appUser.id),

    // Los dos instantes, y la diferencia entre ellos es el diseño: los plazos del
    // MLITSD por una lesión cuentan desde `occurredAt`, el del WSIB desde `reportedAt`.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),

    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),

    // Los nueve campos guiados de §4. No hay un cuadro de texto libre único.
    taskPerformed: text('task_performed').notNull(),
    equipmentInvolved: text('equipment_involved').notNull(),
    whatHappened: text('what_happened').notNull(),
    bodyPart: text('body_part').$type<BodyPart>().notNull(),
    onSiteTreatment: text('on_site_treatment').$type<OnSiteTreatment>().notNull(),
    immediateAction: text('immediate_action').notNull(),

    // Riesgo G: se conserva el texto exacto y se anota el idioma. Sin traducción.
    narrativeLanguage: text('narrative_language').$type<NarrativeLanguage>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.siteId, table.locationId],
      foreignColumns: [location.siteId, location.id],
    }),

    // Destino de las FK compuestas de las tablas hijas.
    unique('incident_id_site_uq').on(table.id, table.siteId),

    index('incident_site_reported_idx').on(table.siteId, table.reportedAt),
    index('incident_reporter_idx').on(table.siteId, table.reportedBy),
    index('incident_classification_idx').on(
      table.siteId,
      table.classification,
      table.occurredAt,
    ),
  ],
);

/**
 * El stream de estados del incidente (migración 0012). §4: los estados son "un stream
 * de eventos, con el mismo motor que la acción correctiva".
 *
 * Mismo motor quiere decir mismo diseño, no código compartido: `position` por
 * incidente, el único `(incidentId, position)` contra la bifurcación, y la tabla de
 * transiciones escrita dos veces —acá como dato en `@hs/contracts`, allá como guarda
 * en SQL— con un test de integración que las compara.
 *
 * A diferencia de la acción correctiva, **`closed` no es terminal**: §4 pide la
 * reapertura con motivo, y es una fila más del stream.
 */
export const incidentEvent = pgTable(
  'incident_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    position: integer('position').notNull(),

    // Nulo solo en el evento de reporte.
    fromState: text('from_state').$type<IncidentState>(),

    toState: text('to_state').$type<IncidentState>().notNull(),

    // Una CUENTA. `incident.subjectPersonId` es una PERSONA.
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => appUser.id),

    note: text('note'),

    // Obligatorio al cerrar sin investigar y al reabrir, y solo ahí.
    reason: text('reason'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.incidentId, table.siteId],
      foreignColumns: [incident.id, incident.siteId],
    }),

    // La defensa contra la bifurcación del stream, y a la vez el índice que resuelve
    // el `DISTINCT ON` del estado vigente leído al revés.
    unique('incident_event_position_uq').on(table.incidentId, table.position),
  ],
);

/**
 * Los testigos (migración 0012).
 *
 * Referencias a Persona por el mismo selector que el sujeto, y por la misma razón: §4
 * dice "reutiliza el selector sin ver perfiles". Un testigo no gana cuenta, no recibe
 * notificación y no se entera de que fue nombrado.
 */
export const incidentWitness = pgTable(
  'incident_witness',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.incidentId, table.siteId],
      foreignColumns: [incident.id, incident.siteId],
    }),
    unique('incident_witness_person_uq').on(table.incidentId, table.personId),
  ],
);

/**
 * La investigación (migración 0012). §4: "causa raíz estructurada (5 porqués o
 * árbol), testigos, secuencia de eventos".
 *
 * Una por incidente, creada en la misma transacción que la transición a
 * `under_investigation`: no hay incidente en investigación sin investigación, y una
 * restricción diferida lo garantiza.
 *
 * `method` se registra y **no se infiere**: deducirlo de la forma del grafo sería
 * adivinar, porque un árbol con una sola rama es indistinguible de una cadena.
 */
export const investigation = pgTable(
  'investigation',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    incidentId: uuid('incident_id')
      .notNull()
      .unique()
      .references(() => incident.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    method: text('method').$type<InvestigationMethod>().notNull(),

    sequenceOfEvents: text('sequence_of_events'),

    openedBy: uuid('opened_by')
      .notNull()
      .references(() => appUser.id),

    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.incidentId, table.siteId],
      foreignColumns: [incident.id, incident.siteId],
    }),

    // Destino de las FK compuestas de las causas y de `corrective_action`.
    unique('investigation_id_site_uq').on(table.id, table.siteId),
  ],
);

/**
 * Las causas del análisis (migración 0012).
 *
 * **Una sola tabla para los cinco porqués y para el árbol**: el árbol es la lista con
 * padres, y los cinco porqués son el árbol degenerado en cadena. No es un JSON con el
 * árbol entero porque cada causa dejaría de tener su propia entrada en la cadena de
 * hashes, y "se agregó una causa" y "se reescribió el árbol" serían indistinguibles.
 *
 * Sin al menos una fila con `isRoot`, el incidente no se cierra.
 */
export const investigationCause = pgTable(
  'investigation_cause',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    investigationId: uuid('investigation_id')
      .notNull()
      .references(() => investigation.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    position: integer('position').notNull(),

    statement: text('statement').notNull(),

    isRoot: boolean('is_root').notNull().default(false),

    // La rama del árbol. Nulo en la cadena y en la primera causa.
    parentCauseId: uuid('parent_cause_id'),

    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => appUser.id),

    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.investigationId, table.siteId],
      foreignColumns: [investigation.id, investigation.siteId],
    }),
    foreignKey({
      columns: [table.parentCauseId],
      foreignColumns: [table.id],
    }),
    unique('investigation_cause_position_uq').on(table.investigationId, table.position),
  ],
);

export type Incident = typeof incident.$inferSelect;
export type NewIncident = typeof incident.$inferInsert;

export type IncidentEvent = typeof incidentEvent.$inferSelect;
export type NewIncidentEvent = typeof incidentEvent.$inferInsert;

export type IncidentWitness = typeof incidentWitness.$inferSelect;
export type NewIncidentWitness = typeof incidentWitness.$inferInsert;

export type Investigation = typeof investigation.$inferSelect;
export type NewInvestigation = typeof investigation.$inferInsert;

export type InvestigationCause = typeof investigationCause.$inferSelect;
export type NewInvestigationCause = typeof investigationCause.$inferInsert;
