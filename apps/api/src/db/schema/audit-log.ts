import {
  bigint,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * ADR-004 — La fuente de verdad de esta tabla es
 * `apps/api/drizzle/0002_audit_log.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva
 * además el trigger de la cadena, `hs_make_immutable` y `hs_apply_site_isolation`,
 * que ningún esquema de ORM sabe expresar. Por eso `drizzle-kit generate` está
 * prohibido: regeneraría el `.sql` a partir de esto y se llevaría puesto el
 * mecanismo. Si el SQL cambia, este espejo se actualiza a mano.
 */

// Drizzle no trae un tipo `bytea` de fábrica. `Buffer` es lo que devuelve `pg`.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),

    // Sin referencia: la tabla `site` llega en la etapa 2, que agrega la FK.
    siteId: uuid('site_id').notNull(),

    // Los cuatro campos que asigna el trigger `BEFORE INSERT`. Se declaran para
    // poder leerlos; escribirlos no tiene efecto, la base los sobrescribe.
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    prevHash: bytea('prev_hash'),
    hash: bytea('hash').notNull(),

    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),

    // Lo manda el dispositivo: puede ser de días atrás si la captura fue offline.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('audit_log_site_seq_uq').on(table.siteId, table.seq),
    index('audit_log_site_recorded_at_idx').on(table.siteId, table.recordedAt),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;

/**
 * Lo que un caller puede aportar. `seq`, `recorded_at`, `prev_hash` y `hash` no
 * están: los pone la base.
 */
export type NewAuditLogEntry = Pick<
  typeof auditLog.$inferInsert,
  'siteId' | 'actorUserId' | 'eventType' | 'payload' | 'occurredAt'
>;
