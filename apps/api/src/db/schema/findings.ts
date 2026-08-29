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

import type { FindingOrigin } from '@hs/contracts';

import { location, site } from './catalog';
import { appUser } from './identity';
import { inspection } from './inspections';
import { templateItem, templateVersionItem } from './templates';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0010_findings.sql` y la migración 0037, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * la restricción diferida de "al menos una foto", los de prohibición de
 * UPDATE/DELETE/TRUNCATE, los de auditoría, `hs_apply_site_isolation` y los GRANT.
 * Nada de eso lo sabe expresar un esquema de ORM. Por eso `drizzle-kit
 * generate` está prohibido: regeneraría el `.sql` a partir de esto y se llevaría
 * puesto el mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * **No hay ningún tipo `*Update` en este archivo y esa ausencia es deliberada**,
 * igual que en `inspections.ts`: 0010 no tiene un solo `GRANT UPDATE`.
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
    // manual. Un hallazgo manual no nace de una pregunta, así que no tiene concepto
    // estable al que referirse (§5 riesgo F).
    inspectionId: uuid('inspection_id').references(() => inspection.id),
    templateVersionItemId: uuid('template_version_item_id').references(
      () => templateVersionItem.id,
    ),
    itemKey: text('item_key').references(() => templateItem.itemKey),

    // La lista cerrada de la pregunta 1 de §6, obligatoria en los dos orígenes.
    locationId: uuid('location_id').references(() => location.id),

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

    // Destino de la FK compuesta de `findingPhoto`.
    unique('finding_id_site_uq').on(table.id, table.siteId),

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

/* La clasificación de riesgo fue retirada por la migración 0037. */

export type Finding = typeof finding.$inferSelect;
export type FindingPhoto = typeof findingPhoto.$inferSelect;

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
