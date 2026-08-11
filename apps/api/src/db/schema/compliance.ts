import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appUser } from './identity';
import { site } from './catalog';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0014_compliance_reports.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * `hs_make_immutable`, `hs_apply_site_isolation`, los dos triggers que appendean a la
 * cadena de auditoría y los GRANT. Nada de eso lo sabe expresar un esquema de ORM. Por
 * eso `drizzle-kit generate` está prohibido: regeneraría el `.sql` a partir de esto y se
 * llevaría puesto el mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**, igual
 * que en `findings.ts`, `inspections.ts` y `recurrence.ts`: 0014 no tiene un solo
 * `GRANT UPDATE`. Un reporte equivocado no se edita, se genera otro.
 */

/**
 * El reporte de cumplimiento congelado (migración 0014). Requisitos §3 R5.
 *
 * `payload` es el documento entero y `payloadHash` es su digest SHA-256 sobre la
 * serialización canónica RFC 8785. **El digest es del payload y nunca del PDF**
 * (ADR-002): el archivo no es reproducible byte a byte y el payload sí.
 */
export const complianceReport = pgTable(
  'compliance_report',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // Fechas civiles: un período es un mes del calendario, no una ventana de tiempo
    // absoluto. `mode: 'string'` porque es lo que el contrato transporta (`YYYY-MM-DD`).
    rangeStart: date('range_start', { mode: 'string' }).notNull(),
    rangeEnd: date('range_end', { mode: 'string' }).notNull(),

    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),

    // NOT NULL: generar evidencia regulatoria es siempre un acto de alguien.
    generatedBy: uuid('generated_by')
      .notNull()
      .references(() => appUser.id),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('compliance_report_site_generated_idx').on(table.siteId, table.generatedAt),

    // Destino de la FK compuesta del render.
    unique('compliance_report_id_site_uq').on(table.id, table.siteId),

    check('compliance_report_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'compliance_report_range_start_check',
      sql`EXTRACT(day FROM ${table.rangeStart}) = 1`,
    ),
    check(
      'compliance_report_range_end_check',
      sql`EXTRACT(day FROM (${table.rangeEnd} + 1)) = 1`,
    ),
    check('compliance_report_range_order_check', sql`${table.rangeEnd} >= ${table.rangeStart}`),
  ],
);

export type ComplianceReportRow = typeof complianceReport.$inferSelect;

/**
 * Lo que un caller aporta al congelar un reporte. `id` y `generatedAt` no están: los pone
 * la base.
 */
export type NewComplianceReport = Pick<
  typeof complianceReport.$inferInsert,
  'siteId' | 'rangeStart' | 'rangeEnd' | 'payload' | 'payloadHash' | 'generatedBy'
>;

/**
 * Un intento de render, terminado (migración 0014).
 *
 * No existe `queued`: la fila se inserta cuando el intento terminó, porque un estado
 * intermedio tendría que pasar después a `succeeded` y esta tabla no admite `UPDATE`.
 */
export const complianceReportRender = pgTable(
  'compliance_report_render',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    reportId: uuid('report_id')
      .notNull()
      .references(() => complianceReport.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    outcome: text('outcome').notNull(),

    // Derivada por el servidor de sitio + reporte + intento. Nunca viene del request.
    objectKey: text('object_key'),

    error: text('error'),

    renderedAt: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('compliance_report_render_report_idx').on(table.reportId, table.renderedAt),

    // El sitio del render es el de su reporte, verificado por el motor.
    foreignKey({
      name: 'compliance_report_render_report_site_fk',
      columns: [table.reportId, table.siteId],
      foreignColumns: [complianceReport.id, complianceReport.siteId],
    }),

    check('compliance_report_render_outcome_check', sql`${table.outcome} IN ('succeeded', 'failed')`),
    check(
      'compliance_report_render_object_check',
      sql`(${table.outcome} = 'succeeded') = (${table.objectKey} IS NOT NULL)`,
    ),
    check(
      'compliance_report_render_error_check',
      sql`(${table.outcome} = 'failed') = (${table.error} IS NOT NULL)`,
    ),
  ],
);

export type ComplianceReportRenderRow = typeof complianceReportRender.$inferSelect;

export type NewComplianceReportRender = Pick<
  typeof complianceReportRender.$inferInsert,
  'reportId' | 'siteId' | 'outcome' | 'objectKey' | 'error'
>;
