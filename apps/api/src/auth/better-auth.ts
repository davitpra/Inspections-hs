import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

/**
 * ADR-011 — better-auth dentro de `apps/api`, sobre la misma Postgres.
 *
 * Lo que la librería aporta acá es acotado y deliberado: el hash de contraseña, la
 * verificación del par email/contraseña y la fila de sesión. Todo lo demás —la
 * invitación, el segundo factor obligatorio por rol, la rotación del refresh, el
 * bloqueo por intentos, el alcance por sitio— es de este change, porque son reglas de
 * este sistema y no de una librería de autenticación.
 *
 * EL MAPEO DE MODELOS (design D2). `user` apunta a `app_user`, que es donde ya vive
 * el email: una tabla propia de better-auth con su propio `email` crearía dos
 * verdades sobre la misma dirección, y "¿cuál gana?" no tiene respuesta buena — menos
 * todavía el día que haya que revocarle el acceso a alguien.
 *
 * NO SE LE AGREGA NINGUNA COLUMNA A `app_user`, y eso se verificó. Su modelo de
 * usuario declara `name`, `emailVerified`, `image` y `updatedAt` como requeridas,
 * pero solo rige cuando es él quien inserta o actualiza al usuario, y acá nunca lo
 * hace: las cuentas las crea el coordinador y el alta de credencial es la aceptación
 * de una invitación, no un `signUp`. Con las cuatro ausentes, el login resuelve la
 * cuenta por email, emite token y crea la sesión. El requisito de que el nombre viva
 * una sola vez, en `person`, queda intacto.
 */
/**
 * El tipo se INFIERE de la fábrica y no se escribe como `ReturnType<typeof
 * betterAuth>`: better-auth tipa su instancia contra las opciones concretas que
 * recibe, así que el tipo genérico y el real no son asignables entre sí. Inferirlo es
 * además lo correcto — el día que cambie el mapeo de modelos, el tipo cambia solo.
 */
export type AuthInstance = ReturnType<typeof createBetterAuth>;

/** El token de inyección de Nest. La instancia es una sola para todo el proceso. */
export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

export interface BetterAuthDeps {
  pool: Pool;
  secret: string;
  baseURL: string;
  /**
   * Qué hacer cuando la librería quiere borrar una sesión. Ver el bloque largo de
   * abajo: no es un gancho de conveniencia, es la barrera.
   */
  onSessionDelete: (sessionId: string) => Promise<void>;
}

export function createBetterAuth({
  pool,
  secret,
  baseURL,
  onSessionDelete,
}: BetterAuthDeps) {
  return betterAuth({
    secret,
    baseURL,
    database: pool,

    emailAndPassword: {
      enabled: true,
      // No hay correo transaccional (design D9): el alta y el reinicio pasan por una
      // invitación que emite el coordinador. Habilitar estos dos crearía rutas que
      // prometen un email que nadie manda.
      autoSignIn: false,
      requireEmailVerification: false,
      sendResetPassword: undefined,
    },

    // Fuera de alcance por ADR-011. Se apagan explícitamente en vez de dejarlos en su
    // default: un default puede cambiar en una versión menor, una línea no.
    emailVerification: { sendOnSignUp: false },

    user: {
      modelName: 'app_user',
      fields: { createdAt: 'created_at' },
    },

    session: {
      modelName: 'app_session',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      },
    },

    account: {
      modelName: 'app_credential',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    verification: {
      modelName: 'app_verification',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },

    databaseHooks: {
      session: {
        delete: {
          /**
           * LA BARRERA (design D15), y el hallazgo que la obliga.
           *
           * better-auth EMITE `DELETE` sobre `app_session` al cerrar sesión. El motor
           * se lo frena —`hs_app` no tiene el privilegio y además hay trigger—, pero
           * la librería trata ese error como interno, lo registra y **le responde
           * `200 {"success":true}` al cliente**. Resultado: el usuario cree que cerró
           * sesión, la fila sigue viva y su token sigue autenticando. Es el peor de
           * los tres desenlaces posibles, peor que borrar y peor que fallar.
           *
           * El invariante de ADR-002 se sostiene siempre sobre "si el código se
           * olvida, el motor frena y el error se ve". Este es el único lugar del
           * sistema donde esa segunda mitad no se cumple, y por eso la barrera tiene
           * que estar acá arriba: se intercepta el borrado, se escribe `revoked_at` y
           * se devuelve `false` para que la sentencia no llegue a emitirse.
           *
           * Cubre los cinco caminos de la librería a la vez —`signOut`,
           * `revokeSession`, `revokeSessions`, `revokeOtherSessions` y la limpieza de
           * expiradas— porque todos pasan por acá.
           *
           * Los triggers `BEFORE DELETE` de la migración se dejan puestos igual: son
           * la red de abajo, y su valor es que si alguien quita este hook el borrado
           * sigue sin ocurrir. Lo que no pueden dar es el error visible.
           */
          before: async (session) => {
            await onSessionDelete(String(session.id));
            return false;
          },
        },
      },
    },
  });
}
