import type { ResponseType, TemplateDocument, VisibleWhen } from '@hs/contracts';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0003_template_model.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva
 * además los triggers de numeración, de proyección del documento a filas y de
 * `item_key` inmutable, más `hs_make_immutable` y los `REVOKE` — nada de eso lo
 * sabe expresar un esquema de ORM. Por eso `drizzle-kit generate` está
 * prohibido: regeneraría el `.sql` a partir de esto y se llevaría puesto el
 * mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 */

/** La cabecera. Mutable en `name` y `deactivated_at`, y solo para hs_migrator. */
export const template = pgTable('template', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

/**
 * El **concepto**, no su proyección en una versión. Existe separada porque
 * `deactivated_at` es un UPDATE y una versión publicada no admite ninguno.
 */
export const templateItem = pgTable('template_item', {
  itemKey: text('item_key').primaryKey(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => template.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),

  // Rastro de linaje (§4), no regla de agrupación: la recurrencia no une la
  // serie del reemplazante con la del reemplazado.
  replacesItemKey: text('replaces_item_key'),
});

/** El documento publicado, congelado. `hs_make_immutable` en la migración. */
export const templateVersion = pgTable(
  'template_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id),
    version: integer('version').notNull(),

    // La forma la valida `templateDocumentSchema` de @hs/contracts. Tipar acá el
    // JSONB con el mismo tipo es lo que evita que la API y el cliente lean el
    // documento con dos formas distintas.
    document: jsonb('document').$type<TemplateDocument>().notNull(),

    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),

    // Sin referencia: la tabla `user` llega en la etapa 2, que agrega la FK.
    publishedBy: uuid('published_by'),
  },
  (table) => [unique('template_version_template_version_uq').on(table.templateId, table.version)],
);

/**
 * La identidad dual, que es el punto entero de este esquema:
 *
 *   id        la fila de esta versión — fidelidad legal. Cambia en cada versión.
 *   itemKey   el concepto — clave de agrupación de la recurrencia. No cambia.
 */
export const templateVersionItem = pgTable(
  'template_version_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => templateVersion.id),
    itemKey: text('item_key')
      .notNull()
      .references(() => templateItem.itemKey),
    sectionKey: text('section_key').notNull(),
    sectionTitle: text('section_title').notNull(),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    responseType: text('response_type').$type<ResponseType>().notNull(),
    required: boolean('required').notNull(),

    // Proyectadas por el trigger desde el documento (migración 0007). Nulables:
    // las filas publicadas antes de 0007 son de los cuatro tipos originales, que
    // no llevan configuración, y re-proyectarlas sería escribir sobre una tabla
    // inmutable. La fuente de verdad para validar sigue siendo `document`.
    config: jsonb('config').$type<Record<string, unknown>>(),
    visibleWhen: jsonb('visible_when').$type<VisibleWhen>(),
  },
  (table) => [
    unique('template_version_item_key_uq').on(table.templateVersionId, table.itemKey),
    unique('template_version_item_position_uq').on(
      table.templateVersionId,
      table.sectionKey,
      table.position,
    ),
    // El índice del GROUP BY de recurrencia de la etapa 7.
    index('template_version_item_key_idx').on(table.itemKey),
  ],
);

/**
 * El mismo enum que el `CHECK` del SQL. Ya no se escribe acá: viene de
 * `@hs/forms` vía `@hs/contracts`, que es donde el motor lo define. La única
 * copia que queda es la del SQL, y un test de integración la compara.
 */
export type { ResponseType };

export type Template = typeof template.$inferSelect;
export type TemplateItemRow = typeof templateItem.$inferSelect;
export type TemplateVersion = typeof templateVersion.$inferSelect;
export type TemplateVersionItem = typeof templateVersionItem.$inferSelect;
