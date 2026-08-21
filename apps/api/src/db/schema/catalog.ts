import { index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0004_site_location_catalog.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva
 * además el trigger de mutabilidad parcial, el de auditoría del catálogo,
 * `hs_apply_site_isolation` y los GRANT por columna — nada de eso lo sabe
 * expresar un esquema de ORM. Por eso `drizzle-kit generate` está prohibido:
 * regeneraría el `.sql` a partir de esto y se llevaría puesto el mecanismo. Si el
 * SQL cambia, este espejo se actualiza a mano.
 */

/**
 * Las plantas. Dato de referencia de la organización: sin política RLS. `hs_app` puede
 * insertar una planta desde la consola, pero no puede actualizarla ni borrarla.
 */
export const site = pgTable('site', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

/**
 * El catálogo cerrado, por sitio. Un solo nivel: sin padre, sin geometría, sin
 * código escaneable.
 *
 * Lleva política RLS por `site_id`: una consulta que no declara alcance con
 * `withSiteScope` no devuelve ninguna fila. No es un bug, es el default.
 */
export const organizationLocation = pgTable('organization_location', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

export const location = pgTable(
  'location',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // `code` es la identidad y no cambia nunca; `name` es la etiqueta que ve el
    // operador y el coordinador la corrige cuando quiere.
    code: text('code').notNull(),
    name: text('name').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // La baja es lógica: no hay DELETE en ninguna de las dos tablas.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    organizationLocationId: uuid('organization_location_id').references(
      () => organizationLocation.id,
    ),
  },
  (table) => [
    unique('location_site_code_uq').on(table.siteId, table.code),

    // Destino de la FK compuesta `(site_id, location_id)` que van a declarar
    // `inspection` y `finding`. Redundante como restricción, necesario igual.
    unique('location_site_id_uq').on(table.siteId, table.id),

    // Únicos e índices parciales: solo sobre las activas. Un nombre liberado por
    // una baja vuelve a estar disponible.
    uniqueIndex('location_site_active_name_uq')
      .on(table.siteId, table.name)
      .where(sql`${table.deactivatedAt} IS NULL`),
    index('location_site_active_idx')
      .on(table.siteId, table.name)
      .where(sql`${table.deactivatedAt} IS NULL`),
  ],
);

export type Site = typeof site.$inferSelect;
export type Location = typeof location.$inferSelect;
export type OrganizationLocation = typeof organizationLocation.$inferSelect;

/**
 * Lo que un caller puede cambiar de una ubicación. `id`, `site_id`, `code` y
 * `created_at` no están: el GRANT por columna se los niega a hs_app y el trigger
 * `location_guard` se los niega a todos.
 */
export type LocationUpdate = Partial<Pick<Location, 'name' | 'deactivatedAt'>>;
