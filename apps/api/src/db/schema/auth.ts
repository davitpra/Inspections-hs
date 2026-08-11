import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { appUser } from './identity';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0006_authentication.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * los triggers de mutabilidad parcial, los de auditoría por sitio, la política de
 * ventana de fechas y los GRANT por columna — nada de eso lo sabe expresar un
 * esquema de ORM. Si el SQL cambia, este espejo se actualiza a mano.
 *
 * Tres de estas cuatro tablas las escribe better-auth a través de su adaptador y no
 * este esquema. Están declaradas igual porque el guard, la rotación del refresh y la
 * revocación en cascada sí las consultan desde acá, y porque un espejo incompleto es
 * peor que no tenerlo.
 *
 * `app_two_factor` fue la quinta hasta `remove-two-factor-for-mvp`, que la dropeó
 * junto con `app_session.purpose` en `0015_remove_two_factor.sql`.
 */

/**
 * La credencial. Es el modelo `account` de better-auth, renombrado: en este proyecto
 * "cuenta" ya significa `app_user`.
 *
 * `password` guarda el hash scrypt de la librería. El nombre de la columna lo impone
 * ella y no se mapea a `password_hash` para no tener que recordar la traducción cada
 * vez que se lee el esquema.
 */
export const appCredential = pgTable(
  'app_credential',
  {
    // text y no uuid: los ids de las filas que inserta better-auth los genera él.
    id: text('id').primaryKey(),

    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),

    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),

    // Solo las usan los proveedores OAuth. Nulas mientras SSO esté fuera de alcance.
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),

    password: text('password'),

    // El bloqueo por intentos fallidos. El umbral y la duración viven en el código:
    // son política, no esquema.
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // better-auth la reescribe en cada UPDATE suyo.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Revocar es esto. Las revocadas se conservan.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('app_credential_active_uq')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('app_credential_user_id_idx').on(table.userId),
  ],
);

/**
 * La invitación. Tabla del proyecto: el ciclo que pide ADR-011 —emitida por el
 * coordinador, con vencimiento, de un solo uso, revocable— es una regla propia y no
 * el flujo de invitación de organizaciones de la librería.
 *
 * El token se guarda hasheado y el valor en claro se muestra una sola vez.
 */
export const userInvitation = pgTable(
  'user_invitation',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),

    // Es lo que hace que "el coordinador dio de alta a esta persona" tenga nombre.
    issuedByUserId: uuid('issued_by_user_id')
      .notNull()
      .references(() => appUser.id),

    tokenHash: text('token_hash').notNull().unique(),

    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Una cuenta no puede tener dos invitaciones vivas: revocar una dejaría acceso
    // abierto por la otra y el coordinador no tendría cómo saberlo.
    uniqueIndex('user_invitation_pending_uq')
      .on(table.userId)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  ],
);

/**
 * La sesión. La inserta better-auth con exactamente las columnas que conoce; todo lo
 * que le agregamos es anulable o trae default, porque su INSERT no lo nombra.
 *
 * El token de acceso es OPACO y se resuelve contra esta tabla en cada request. No es
 * un JWT: un JWT con el alcance adentro lo congelaría hasta que expire, y revocarle
 * una planta a alguien tendría un retraso igual a la vida del token.
 */
export const appSession = pgTable(
  'app_session',
  {
    id: text('id').primaryKey(),

    token: text('token').notNull().unique(),

    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('app_session_live_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * El refresh. Tabla propia y no columnas de `app_session` por dos motivos: la sesión
 * la inserta better-auth y no puede recibir una columna NOT NULL que él no conoce; y
 * la rotación es de N a 1 — una sesión emite muchos refresh y la unidad que se
 * revoca sigue siendo la sesión.
 *
 * Acá el hash es innegociable: este token vive 14 días y es lo único que le permite
 * a un dispositivo que estuvo una semana sin señal volver a autenticarse.
 */
export const appRefreshToken = pgTable(
  'app_refresh_token',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    sessionId: text('session_id')
      .notNull()
      .references(() => appSession.id),

    tokenHash: text('token_hash').notNull().unique(),

    // La cadena de rotación: reusar un token gastado la revoca entera.
    parentId: uuid('parent_id'),

    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // `replacedById` es lo que permite devolver el MISMO par dentro de la ventana de
    // gracia, en lugar de expulsar a un cliente cuya red se cortó a mitad del
    // refresh.
    spentAt: timestamp('spent_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('app_refresh_token_session_idx').on(table.sessionId)],
);

/**
 * Material efímero de un solo uso de better-auth. En este sistema queda vacía: los
 * flujos que la usan —verificación de email, reinicio por link, OTP por correo—
 * están fuera de alcance por ADR-011 y por design D9. Existe para que su consulta no
 * falle con 42P01 en runtime.
 */
export const appVerification = pgTable('app_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
