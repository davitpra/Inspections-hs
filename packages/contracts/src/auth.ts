import { z } from 'zod';

import { roleSchema } from './identity.js';

/**
 * ADR-011 — La forma de la autenticación, compartida por las dos puntas.
 *
 * `identity.ts` describe *quién existe*: la persona, la cuenta, el rol, el alcance.
 * Acá está lo que faltaba: cómo esa cuenta demuestra que es ella, qué transporta la
 * sesión que resulta, y cómo se renueva sin volver a pedir la contraseña.
 *
 * Lo que estos esquemas NO validan es todo lo que depende del estado: que la
 * invitación no esté vencida, que la contraseña sea la correcta, que la cuenta siga
 * activa. Eso vive en `apps/api/drizzle/0006_authentication.sql` y en el módulo de
 * autenticación. Zod valida la forma; el motor y el guard validan los hechos.
 */

/**
 * Los tres desenlaces de una llamada autenticada (design D5), y la razón por la que
 * esta unión es un contrato y no un detalle del servidor.
 *
 * El requisito offline de ADR-011 —"una entrada del outbox nunca se descarta por un
 * 401"— solo es implementable si el cliente puede distinguir "renová y reintentá"
 * de "pará". El status HTTP solo no alcanza: los dos primeros son `401`. Un cliente
 * que tuviera que separarlos leyendo un mensaje en inglés sería un cliente frágil,
 * y lo que se rompería es la cola de una inspección de tres horas.
 */
export const AUTH_ERROR_CODES = [
  /** Access token vencido, refresh vivo. El cliente refresca y REINTENTA. */
  'token_expired',

  /**
   * Sesión revocada, cuenta desactivada o vencida, refresh vencido. El cliente pide
   * login de nuevo y NO descarta nada de lo que tenía en cola.
   */
  'session_ended',

  /**
   * Credenciales inválidas. Deliberadamente el mismo código para email inexistente
   * y contraseña incorrecta: el spec exige que no se distingan.
   */
  'invalid_credentials',

  /** La cuenta está bloqueada por intentos fallidos. Es temporal. */
  'account_locked',

  /** Falta el segundo factor, o el código es inválido. */
  'two_factor_required',

  /**
   * La sesión es válida pero es de alcance limitado: el titular tiene que inscribir
   * su segundo factor antes de que sirva para otra cosa (design D7).
   */
  'two_factor_enrolment_required',

  /** La sesión es válida y el rol o el alcance no alcanzan. Ni refresca ni reintenta. */
  'forbidden',

  /** La invitación no existe, venció, ya se usó o fue revocada. */
  'invitation_invalid',
] as const;

export const authErrorCodeSchema = z.enum(AUTH_ERROR_CODES);

export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;

/** El cuerpo de todo error de autenticación. El código va acá, no en el status. */
export const authErrorSchema = z.object({
  code: authErrorCodeSchema,
  message: z.string().min(1),
});

export type AuthError = z.infer<typeof authErrorSchema>;

/**
 * Los únicos dos códigos ante los cuales una entrada de la cola se REINTENTA en vez
 * de fallar. Se exporta como función y no como lista suelta para que el cliente del
 * outbox de la etapa 3 no tenga que reconstruir el criterio.
 *
 * Ningún código de esta unión significa "descartá la entrada", y eso es deliberado:
 * el servidor no tiene forma de saber si algo de la cola es descartable, así que no
 * lo decide nunca.
 */
export function isRenewable(code: AuthErrorCode): boolean {
  return code === 'token_expired';
}

/** Contraseña. El mínimo es de longitud; la fortaleza real la da el bloqueo (D8). */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .max(200);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** El código TOTP: seis dígitos. */
export const totpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'The code is six digits');

// ---------------------------------------------------------------------------
// Login

export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Obligatorio para una cuenta con segundo factor confirmado; ignorado si no. */
  code: totpCodeSchema.optional(),
});

export type SignInRequest = z.infer<typeof signInRequestSchema>;

/**
 * La sesión resuelta, que es lo que ADR-011 pide que transporte: `user_id`,
 * `person_id` y `site_scope`. Va también el rol, porque el cliente decide qué
 * pantallas ofrecer, y `purpose`, porque una sesión limitada tiene que ser visible
 * para el cliente y no una sorpresa en el primer 403.
 *
 * `siteScope` se resuelve en CADA request contra `user_site_scope` y no se congela
 * en el token (design D4): lo que este objeto muestra es el alcance de ahora.
 */
export const sessionSchema = z.object({
  userId: z.uuid(),
  personId: z.uuid(),
  role: roleSchema,
  siteScope: z.array(z.uuid()),
  purpose: z.enum(['full', 'enrol_two_factor']),
  /** Solo para `external_auditor`: la ventana de registros que puede leer. */
  recordsFrom: z.iso.date().nullable(),
  recordsTo: z.iso.date().nullable(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * El par de tokens. `accessToken` es opaco y se resuelve contra `app_session`
 * (design D3); `refreshToken` es el único que sobrevive días y por eso es el único
 * que se guarda hasheado del lado del servidor.
 */
export const tokenPairSchema = z.object({
  accessToken: z.string().min(1),
  accessExpiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
  refreshExpiresAt: z.iso.datetime(),
});

export type TokenPair = z.infer<typeof tokenPairSchema>;

export const signInResponseSchema = z.object({
  session: sessionSchema,
  tokens: tokenPairSchema,
});

export type SignInResponse = z.infer<typeof signInResponseSchema>;

// ---------------------------------------------------------------------------
// Refresh

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z.object({
  tokens: tokenPairSchema,
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

// ---------------------------------------------------------------------------
// Invitación

/**
 * El default de 72 horas de design D9 vive acá y no como `CHECK` en la migración,
 * por el mismo motivo por el que 0005 dejó el default de 30 días del auditor en el
 * contrato: el motor no distingue "no lo pusiste" de "pusiste 72".
 */
export const INVITATION_DEFAULT_HOURS = 72;
export const INVITATION_MAX_HOURS = 168;

export const issueInvitationRequestSchema = z.object({
  /** La cuenta a invitar. Ya existe: crearla es un acto aparte y anterior. */
  userId: z.uuid(),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(INVITATION_MAX_HOURS)
    .default(INVITATION_DEFAULT_HOURS),
});

export type IssueInvitationRequest = z.infer<typeof issueInvitationRequestSchema>;

/**
 * El token en claro sale UNA sola vez, acá. No hay ninguna ruta que lo vuelva a
 * mostrar: del otro lado solo queda su hash. Si el coordinador lo pierde, revoca la
 * invitación y emite otra — que es el mismo camino que el reinicio de contraseña.
 */
export const issueInvitationResponseSchema = z.object({
  invitationId: z.uuid(),
  userId: z.uuid(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export type IssueInvitationResponse = z.infer<typeof issueInvitationResponseSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const revokeInvitationRequestSchema = z.object({
  invitationId: z.uuid(),
});

export type RevokeInvitationRequest = z.infer<typeof revokeInvitationRequestSchema>;

// ---------------------------------------------------------------------------
// Segundo factor

/**
 * `secret` y `uri` salen una sola vez, en la respuesta de inscripción, para que el
 * titular los cargue en su aplicación. Después de confirmar, ninguna ruta los
 * devuelve.
 */
export const enrolTwoFactorResponseSchema = z.object({
  secret: z.string().min(1),
  uri: z.string().min(1),
});

export type EnrolTwoFactorResponse = z.infer<typeof enrolTwoFactorResponseSchema>;

export const confirmTwoFactorRequestSchema = z.object({
  code: totpCodeSchema,
});

export type ConfirmTwoFactorRequest = z.infer<typeof confirmTwoFactorRequestSchema>;

export const resetTwoFactorRequestSchema = z.object({
  userId: z.uuid(),
});

export type ResetTwoFactorRequest = z.infer<typeof resetTwoFactorRequestSchema>;

// ---------------------------------------------------------------------------
// Revocación

export const revokeSessionsRequestSchema = z.object({
  userId: z.uuid(),
});

export type RevokeSessionsRequest = z.infer<typeof revokeSessionsRequestSchema>;

/**
 * Los roles para los que el segundo factor es OBLIGATORIO (ADR-011). Vive en el
 * contrato y no solo en el servidor porque el cliente tiene que poder explicarle al
 * titular por qué su sesión no sirve todavía, antes de recibir el primer 403.
 */
export const ROLES_REQUIRING_TWO_FACTOR = ['hs_coordinator', 'management'] as const;

export function requiresTwoFactor(role: z.infer<typeof roleSchema>): boolean {
  return (ROLES_REQUIRING_TWO_FACTOR as readonly string[]).includes(role);
}
