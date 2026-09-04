import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { site } from './catalog';
import { appUser } from './identity';

/**
 * ADR-004 — La fuente de verdad de esta tabla es
 * `apps/api/drizzle/0008_inspection_scheduling.sql`, no este archivo, y la lista de
 * `kind` la amplía `0011_corrective_actions.sql`. Ver la cabecera de `inspections.ts`:
 * el SQL lleva el trigger de guarda, los de prohibición de DELETE/TRUNCATE, la política
 * de aislamiento y los GRANT por columna.
 */

/**
 * Los tipos de notificación. La lista está cerrada por CHECK en el motor, y la misma
 * lista es la unión discriminada de `@hs/contracts`, que además fija la forma del
 * payload de cada uno — cosa que un CHECK no puede hacer.
 */
export const NOTIFICATION_KINDS = [
  'inspection_period_opened',
  'corrective_action_assigned',
  'corrective_action_overdue_supervisor',
  'corrective_action_overdue_management',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * La bandeja in-app.
 *
 * ADR-011 design D9: no hay servidor de correo y no se agrega uno. La notificación al
 * coordinador de HS es in-app o no es nada.
 *
 * `readAt` y `withdrawnAt` son las únicas transiciones. Ninguna vuelve a `NULL`: leer y retirar
 * son hechos monotónicos, y la fila nunca se elimina.
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),

    // Una notificación es contenido operativo de una planta: lleva política RLS.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    kind: text('kind').$type<NotificationKind>().notNull(),

    // La clave de deduplicación DEL PRODUCTOR. Para la apertura del período es
    // `<site_id>:<period_start>`. Con el único de abajo, "una segunda corrida no
    // notifica dos veces" lo resuelve la base y no un SELECT previo del handler.
    dedupeKey: text('dedupe_key').notNull(),

    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    readAt: timestamp('read_at', { withTimezone: true }),

    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'notification_kind_check',
      sql`${table.kind} IN ('inspection_period_opened', 'corrective_action_assigned',
                            'corrective_action_overdue_supervisor',
                            'corrective_action_overdue_management')`,
    ),
    unique('notification_dedupe_uq').on(table.userId, table.kind, table.dedupeKey),
    index('notification_inbox_idx').on(table.userId, table.readAt, table.createdAt),
  ],
);

export type Notification = typeof notification.$inferSelect;

/** Las dos marcas operativas monotónicas de una notificación. */
export type NotificationUpdate = Partial<Pick<Notification, 'readAt' | 'withdrawnAt'>>;
