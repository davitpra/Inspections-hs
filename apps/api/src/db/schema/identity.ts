import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { site } from './catalog';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0005_identity.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva
 * además los triggers de mutabilidad parcial, la normalización del email, los de
 * auditoría por sitio, `hs_apply_site_isolation` y los GRANT por columna — nada de
 * eso lo sabe expresar un esquema de ORM. Por eso `drizzle-kit generate` está
 * prohibido: regeneraría el `.sql` a partir de esto y se llevaría puesto el
 * mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 */

/** Los tres roles vigentes de ADR-022. */
export const ROLES = ['hs_coordinator', 'jhsc_member', 'management'] as const;

export type Role = (typeof ROLES)[number];

/**
 * El roster. Requisitos §4: identificada por número de empleado de ADP, no por
 * nombre. La mayoría de estas filas no tiene cuenta y nunca la va a tener.
 *
 * Lleva política RLS por `site_id`: una consulta que no declara alcance con
 * `withSiteScope` no devuelve ninguna fila. No es un bug, es el default.
 */
export const person = pgTable(
  'person',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // La identidad. Inmutable: el mismo número es la misma persona aunque cambien
    // el apellido y la planta.
    employeeNumber: text('employee_number').notNull(),

    // El nombre NO identifica. Dos personas activas pueden llamarse igual.
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),

    // Mutable, a diferencia de `location.site_id`: una persona se transfiere de
    // planta, una ubicación no. Ver el comentario de la migración.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // La baja es lógica: no hay DELETE.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    unique('person_employee_number_uq').on(table.employeeNumber),

    // El selector de sujeto: las activas de un sitio, por apellido.
    index('person_site_active_name_idx')
      .on(table.siteId, table.lastName, table.firstName)
      .where(sql`${table.deactivatedAt} IS NULL`),
  ],
);

/**
 * La cuenta. Se llama `app_user` y no `user` porque `user` es palabra reservada en
 * Postgres y porque better-auth (ADR-011) usa ese nombre por defecto para una de
 * las suyas.
 *
 * **Sin credenciales.** Ni contraseña, ni hash, ni sesión, ni secreto TOTP: eso es
 * el change de auth. Una cuenta de acá es una identidad completa que todavía no
 * puede iniciar sesión.
 *
 * No lleva política RLS: no tiene un sitio, tiene un alcance. Ver el comentario de
 * la migración.
 */
export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // NOT NULL UNIQUE: prohíbe la cuenta compartida y la segunda cuenta de la misma
    // persona. ADR-011 lo pide por nombre.
    personId: uuid('person_id')
      .notNull()
      .unique()
      .references(() => person.id),

    // La única copia del email en el sistema. El motor lo normaliza a minúsculas
    // antes de escribirlo, así que el único atrapa las capitalizaciones.
    email: text('email').notNull().unique(),

    // Exactamente uno de ROLES, forzado por CHECK en el motor.
    role: text('role').notNull().$type<Role>(),

    // El asiento en el JHSC (0035): el momento en que esta cuenta se sentó en el
    // comité, o nulo. Es una POSICIÓN que la cuenta ocupa, no un rol que lleva — el
    // `CHECK` de abajo la reserva para los roles administrativos, porque un
    // `jhsc_member` ya está en el comité por su rol.
    jhscSeatGrantedAt: timestamp('jhsc_seat_granted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    check('app_user_role_check', sql`${table.role} IN ('hs_coordinator', 'jhsc_member', 'management')`),

    check('app_user_jhsc_seat_check', sql`${table.jhscSeatGrantedAt} IS NULL OR ${table.role} IN ('hs_coordinator', 'management')`),
  ],
);

/**
 * El alcance por sitio de una cuenta. Filas y no un arreglo: un arreglo no puede
 * llevar FK y sobrescribirlo borraría el rastro de la revocación, que es
 * exactamente lo que la auditoría trimestral de §2 necesita leer.
 */
export const userSiteScope = pgTable(
  'user_site_scope',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),

    // Revocar es esta columna, nunca un DELETE.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Parcial: permite volver a otorgar un sitio revocado sin chocar con la vieja.
    uniqueIndex('user_site_scope_active_uq')
      .on(table.userId, table.siteId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('user_site_scope_active_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * El lote de una importación del roster. Totalmente inmutable: un reporte que se
 * puede editar no es un reporte.
 */
export const rosterImport = pgTable('roster_import', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Nullable por el mismo motivo que `audit_log.actor_user_id`.
  importedBy: uuid('imported_by').references(() => appUser.id),

  sourceFilename: text('source_filename').notNull(),

  rowsRead: integer('rows_read').notNull(),
  rowsApplied: integer('rows_applied').notNull(),
  rowsRejected: integer('rows_rejected').notNull(),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * El desglose por planta de una importación. Existe porque `audit_log.site_id` es
 * NOT NULL: es la fila de la que el trigger deriva la entrada de resumen de cada
 * sitio, en lugar de un parámetro que el importador tenga que recordar.
 */
export const rosterImportSite = pgTable(
  'roster_import_site',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    importId: uuid('import_id')
      .notNull()
      .references(() => rosterImport.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    rowsApplied: integer('rows_applied').notNull(),
    rowsRejected: integer('rows_rejected').notNull(),
  },
  (table) => [unique('roster_import_site_uq').on(table.importId, table.siteId)],
);

/**
 * Una fila rechazada, con su número 1-based sobre el archivo — el número que el
 * coordinador ve en Excel, que es donde va a ir a arreglarlo.
 */
export const rosterImportRejection = pgTable(
  'roster_import_rejection',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    importId: uuid('import_id')
      .notNull()
      .references(() => rosterImport.id),

    rowNumber: integer('row_number').notNull(),

    // Nullable: el motivo del rechazo puede ser que la fila no traía uno.
    employeeNumber: text('employee_number'),

    reason: text('reason').notNull(),

    // La fila cruda, tal como vino.
    rawRow: jsonb('raw_row').notNull(),
  },
  (table) => [unique('roster_import_rejection_row_uq').on(table.importId, table.rowNumber)],
);

export type Person = typeof person.$inferSelect;
export type AppUser = typeof appUser.$inferSelect;
export type UserSiteScope = typeof userSiteScope.$inferSelect;
export type RosterImport = typeof rosterImport.$inferSelect;
export type RosterImportSite = typeof rosterImportSite.$inferSelect;
export type RosterImportRejection = typeof rosterImportRejection.$inferSelect;

/**
 * Lo que un caller puede cambiar de una persona. `id`, `employee_number` y
 * `created_at` no están: el GRANT por columna se los niega a hs_app y el trigger
 * `person_guard` se los niega a todos.
 */
export type PersonUpdate = Partial<
  Pick<Person, 'firstName' | 'lastName' | 'siteId' | 'deactivatedAt'>
>;

/**
 * Lo que un caller puede cambiar de una cuenta. `person_id` no está: una cuenta no
 * se reasigna de una persona a otra.
 */
export type AppUserUpdate = Partial<
  Pick<AppUser, 'email' | 'role' | 'deactivatedAt' | 'jhscSeatGrantedAt'>
>;

/** Lo único mutable de una fila de alcance. Revocar es esto. */
export type UserSiteScopeUpdate = Partial<Pick<UserSiteScope, 'revokedAt'>>;
