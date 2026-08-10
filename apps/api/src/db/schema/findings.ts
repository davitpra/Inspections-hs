import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ControlLevel, FindingOrigin, Probability, RiskLevel, Severity } from '@hs/contracts';

import { location, site } from './catalog';
import { appUser } from './identity';
import { inspection } from './inspections';
import { templateItem, templateVersionItem } from './templates';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0010_findings.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * la restricción diferida de "al menos una foto", la función `hs_risk_level` que
 * alimenta la columna generada, la guarda de la clasificación, los de prohibición
 * de UPDATE/DELETE/TRUNCATE, los de auditoría, `hs_apply_site_isolation` y los
 * GRANT. Nada de eso lo sabe expresar un esquema de ORM. Por eso `drizzle-kit
 * generate` está prohibido: regeneraría el `.sql` a partir de esto y se llevaría
 * puesto el mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**,
 * igual que en `inspections.ts`: 0010 no tiene un solo `GRANT UPDATE`. Reclasificar
 * un hallazgo es insertar una fila que supera a la vigente, no corregir una.
 */

/**
 * El hallazgo (migración 0010). Requisitos §4 y §3 R2.
 *
 * Los cuatro campos de origen se leen juntos: `origin` dice de dónde vino, y los
 * tres de la identidad dual están los tres o no está ninguno. El `CHECK` de la
 * migración impide cualquier combinación intermedia, así que un `origin` de
 * `'inspection'` implica `itemKey` no nulo aunque el tipo diga que puede serlo —
 * TypeScript no sabe expresar esa correlación y el motor sí.
 */
export const finding = pgTable(
  'finding',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    origin: text('origin').$type<FindingOrigin>().notNull(),

    // Los tres de la identidad dual: no nulos en un hallazgo derivado, nulos en uno
    // manual. Un hallazgo manual queda por lo tanto fuera de la recurrencia (§5
    // riesgo F), que es la consecuencia aceptada por escrito.
    inspectionId: uuid('inspection_id').references(() => inspection.id),
    templateVersionItemId: uuid('template_version_item_id').references(
      () => templateVersionItem.id,
    ),
    itemKey: text('item_key').references(() => templateItem.itemKey),

    // La lista cerrada de la pregunta 1 de §6, obligatoria en los dos orígenes.
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),

    description: text('description').notNull(),

    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => appUser.id),

    // El reloj del dispositivo y el del servidor, otra vez (§5 riesgo C).
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'finding_origin_identity_check',
      sql`(${table.origin} = 'inspection') = (${table.inspectionId} IS NOT NULL)
        AND (${table.inspectionId} IS NULL) = (${table.itemKey} IS NULL)
        AND (${table.inspectionId} IS NULL) = (${table.templateVersionItemId} IS NULL)`,
    ),
    check('finding_description_check', sql`char_length(${table.description}) >= 10`),

    foreignKey({
      columns: [table.inspectionId, table.siteId],
      foreignColumns: [inspection.id, inspection.siteId],
    }),
    foreignKey({
      columns: [table.templateVersionItemId, table.itemKey],
      foreignColumns: [templateVersionItem.id, templateVersionItem.itemKey],
    }),
    foreignKey({
      columns: [table.siteId, table.locationId],
      foreignColumns: [location.siteId, location.id],
    }),

    // Destino de las FK compuestas de `findingPhoto` y `findingRiskAssessment`.
    unique('finding_id_site_uq').on(table.id, table.siteId),

    // El índice de la recurrencia de la etapa 7. Parcial: un hallazgo manual no tiene
    // `item_key` y no entra en ninguna serie. Lleva `location_id` porque la clave útil
    // con 48 acres es concepto + lugar (§5 riesgo A), y cuál de las dos se use es una
    // decisión de la etapa 7.
    index('finding_recurrence_idx')
      .on(table.siteId, table.itemKey, table.locationId)
      .where(sql`${table.itemKey} IS NOT NULL`),
    index('finding_inspection_idx').on(table.inspectionId),
    index('finding_site_recorded_idx').on(table.siteId, table.recordedAt),
  ],
);

/**
 * Las fotos del hallazgo, una por fila (migración 0010).
 *
 * Filas y no un `text[]` en `finding`: `finding` es inmutable, y con un arreglo la
 * foto que alguien saque después no tendría dónde ir. Que exista al menos una la
 * verifica una restricción diferida al commit, no un `CHECK` —un `CHECK` no puede
 * contar filas de otra tabla.
 */
export const findingPhoto = pgTable(
  'finding_photo',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // Una object key del bucket. NUNCA bytes (ADR-001).
    objectKey: text('object_key').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.findingId, table.siteId],
      foreignColumns: [finding.id, finding.siteId],
    }),
    uniqueIndex('finding_photo_key_uq').on(table.findingId, table.objectKey),
  ],
);

/**
 * La clasificación de riesgo (migración 0010). Requisitos §3 R2.
 *
 * **Append-only y encadenada por `supersedesId`.** La vigente es la fila que nadie
 * supera; un hallazgo sin ninguna fila acá está *sin clasificar*, que es una ausencia
 * y no un valor. No hay columna de estado y esa falta es el diseño.
 *
 * `riskLevel` es una columna GENERADA por `hs_risk_level(probability, severity)`: se
 * lee, no se escribe. Por eso no aparece en `NewFindingRiskAssessment`.
 */
export const findingRiskAssessment = pgTable(
  'finding_risk_assessment',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    probability: text('probability').$type<Probability>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),

    // Generada por el motor. Nunca se escribe desde acá — el mismo criterio que
    // `scheduled_inspection.period_end`.
    riskLevel: text('risk_level')
      .$type<RiskLevel>()
      .notNull()
      .generatedAlwaysAs(sql`hs_risk_level(probability, severity)`),

    controlLevel: text('control_level').$type<ControlLevel>().notNull(),

    // La fila que esta supera. Su único es lo que impide que la historia se bifurque:
    // dos reclasificaciones concurrentes de la misma vigente terminan con una que
    // comete y otra que viola el único.
    supersedesId: uuid('supersedes_id'),

    reason: text('reason'),

    assessedBy: uuid('assessed_by')
      .notNull()
      .references(() => appUser.id),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesId],
      foreignColumns: [table.id],
    }),
    unique('finding_risk_assessment_supersedes_id_key').on(table.supersedesId),

    foreignKey({
      columns: [table.findingId, table.siteId],
      foreignColumns: [finding.id, finding.siteId],
    }),

    // Reclasificar exige motivo; clasificar por primera vez no lo admite.
    check(
      'finding_risk_assessment_reason_check',
      sql`(${table.supersedesId} IS NULL) = (${table.reason} IS NULL)`,
    ),
    check(
      'finding_risk_assessment_reason_length_check',
      sql`${table.reason} IS NULL OR char_length(${table.reason}) >= 10`,
    ),

    // Una sola clasificación inicial por hallazgo, y el índice del LEFT JOIN LATERAL
    // que resuelve la vigente en el listado.
    uniqueIndex('finding_risk_assessment_initial_uq')
      .on(table.findingId)
      .where(sql`${table.supersedesId} IS NULL`),
    index('finding_risk_assessment_finding_idx').on(table.findingId, table.assessedAt),
  ],
);

export type Finding = typeof finding.$inferSelect;
export type FindingPhoto = typeof findingPhoto.$inferSelect;
export type FindingRiskAssessment = typeof findingRiskAssessment.$inferSelect;

/**
 * Lo que un caller aporta al insertar un hallazgo. `id` y `recordedAt` no están: los
 * pone la base, y `recordedAt` es el reloj del servidor, que es el punto de que exista.
 */
export type NewFinding = Pick<
  typeof finding.$inferInsert,
  | 'siteId'
  | 'origin'
  | 'inspectionId'
  | 'templateVersionItemId'
  | 'itemKey'
  | 'locationId'
  | 'description'
  | 'reportedBy'
  | 'occurredAt'
>;

export type NewFindingPhoto = Pick<
  typeof findingPhoto.$inferInsert,
  'findingId' | 'siteId' | 'objectKey'
>;

/**
 * Lo que un caller aporta al clasificar. **`riskLevel` no está**: lo calcula el motor
 * y esa ausencia es el requisito (design D5).
 */
export type NewFindingRiskAssessment = Pick<
  typeof findingRiskAssessment.$inferInsert,
  'findingId' | 'siteId' | 'probability' | 'severity' | 'controlLevel' | 'supersedesId' | 'reason' | 'assessedBy'
>;
