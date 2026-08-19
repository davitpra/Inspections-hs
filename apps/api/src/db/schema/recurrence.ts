import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { location, site } from './catalog';
import { finding } from './findings';

/**
 * ADR-004 — La fuente de verdad de esta tabla es
 * `apps/api/drizzle/0013_recurrence.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además el
 * `ALTER TABLE finding ADD CONSTRAINT finding_id_item_key_uq` que hace posible la FK
 * compuesta de abajo, los triggers de prohibición de UPDATE/DELETE/TRUNCATE,
 * `hs_apply_site_isolation` y los GRANT. Nada de eso lo sabe expresar un esquema de ORM.
 * Por eso `drizzle-kit generate` está prohibido: regeneraría el `.sql` a partir de esto y
 * se llevaría puesto el mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**, igual
 * que en `findings.ts` e `inspections.ts`: 0013 no tiene un solo `GRANT UPDATE`. Una
 * marca no se corrige cuando llegan hallazgos nuevos — decir lo que se sabía ese día es
 * su función entera.
 */

/**
 * Lo que el hallazgo sabía de su propia historia al nacer (migración 0013).
 * Requisitos §5 riesgo A y §6-bis pregunta 11.
 *
 * Una fila por hallazgo derivado, escrita dentro de la misma transacción que lo inserta.
 * Un hallazgo manual no tiene fila, y esa ausencia es el estado —no existe un
 * `is_recurrent` en `false` para él, porque nunca se lo comparó con nada.
 *
 * **Esta tabla no es la consulta de recurrencia.** Las series se calculan leyendo
 * `finding` con un `GROUP BY` en el momento de preguntar, con la ventana que el lector
 * pidió. Por eso `prior_count` y el `occurrence_count` de una serie pueden diferir, y
 * por eso acá está `windowMonths`: sin él la diferencia sería inexplicable.
 */
export const findingRecurrence = pgTable(
  'finding_recurrence',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),

    // Denormalizado: la política RLS necesita el sitio en la fila.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // Puede ser NULL cuando la sección no resolvió una ubicación en la planta.
    itemKey: text('item_key').notNull(),

    locationId: uuid('location_id').references(() => location.id),

    windowMonths: integer('window_months').notNull(),

    /** Previos de la misma `item_key` **y la misma ubicación**. */
    priorCount: integer('prior_count').notNull(),

    /** Previos de la misma `item_key` en cualquier ubicación del sitio. */
    priorCountSiteWide: integer('prior_count_site_wide').notNull(),

    /** El del más viejo de los previos. Nulo exactamente cuando `priorCount` es 0. */
    firstPriorOccurredAt: timestamp('first_prior_occurred_at', { withTimezone: true }),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),

    // Generada por el motor. Nunca se escribe desde acá — el mismo criterio que
    // `finding_risk_assessment.risk_level` y `scheduled_inspection.period_end`.
    isRecurrent: boolean('is_recurrent')
      .notNull()
      .generatedAlwaysAs(sql`prior_count > 0`),
  },
  (table) => [
    unique('finding_recurrence_finding_uq').on(table.findingId),

    foreignKey({
      name: 'finding_recurrence_finding_site_fk',
      columns: [table.findingId, table.siteId],
      foreignColumns: [finding.id, finding.siteId],
    }),

    // La barrera del hallazgo manual, y la que impide que una marca reclame una
    // `item_key` que no es la de su hallazgo.
    foreignKey({
      name: 'finding_recurrence_finding_item_fk',
      columns: [table.findingId, table.itemKey],
      foreignColumns: [finding.id, finding.itemKey],
    }),

    check(
      'finding_recurrence_counts_check',
      sql`${table.priorCount} >= 0
        AND ${table.priorCountSiteWide} >= 0
        AND ${table.priorCount} <= ${table.priorCountSiteWide}`,
    ),
    check(
      'finding_recurrence_first_prior_check',
      sql`(${table.priorCount} = 0) = (${table.firstPriorOccurredAt} IS NULL)`,
    ),
    check(
      'finding_recurrence_window_check',
      sql`${table.windowMonths} BETWEEN 1 AND 60`,
    ),
  ],
);

export type FindingRecurrence = typeof findingRecurrence.$inferSelect;

/**
 * Lo que un caller aporta al marcar un hallazgo. `id`, `computedAt` y **`isRecurrent`**
 * no están: los dos primeros los pone la base, y el tercero lo calcula el motor a partir
 * de `priorCount`. Esa última ausencia es el requisito (design D5).
 */
export type NewFindingRecurrence = Pick<
  typeof findingRecurrence.$inferInsert,
  | 'findingId'
  | 'siteId'
  | 'itemKey'
  | 'locationId'
  | 'windowMonths'
  | 'priorCount'
  | 'priorCountSiteWide'
  | 'firstPriorOccurredAt'
>;
