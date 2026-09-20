import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

/**
 * El límite de intentos por IP sobre las rutas que aceptan un secreto adivinable.
 *
 * `AuthService` ya bloquea la CUENTA tras intentos fallidos (ADR-011). Eso frena a quien
 * prueba muchas contraseñas contra un email; no frena a quien prueba una contraseña contra
 * muchos emails, y no frena el costo: cada intento de login hashea una contraseña, que es
 * CPU a propósito, y cien por segundo alcanzan para dejar a la API sin atender a nadie. El
 * límite corre como middleware, antes del guard y antes del hash.
 *
 * **Por qué solo estas dos rutas, y no un límite global.** El outbox vacía de golpe todo lo
 * que un teléfono juntó sin señal —una firma por foto, un envío por inspección—, y lo hace
 * desde la misma IP que los demás teléfonos de la planta. Un 429 ahí convierte un límite de
 * seguridad en una inspección que no sale, que es la métrica que tiene objetivo 0.
 *
 * **Por qué NO `/auth/refresh`**, que también acepta un secreto. `performRefresh` en
 * `apps/web/src/auth/session-client.ts` trata CUALQUIER respuesta no-OK como sesión
 * terminada: borra el token y manda al inspector a la pantalla de login. Un 429 en el
 * refresh desloguearía a toda una planta que vuelve a tener señal a la vez. Y no hace falta:
 * el refresh token son 32 bytes aleatorios (`tokens.ts`) y no se adivina por fuerza bruta.
 *
 * **Los números asumen NAT.** Toda una planta sale a internet por una sola IP, así que el
 * límite es de la planta y no de la persona. 30 logins en 15 minutos cubren un cambio de
 * turno entero con errores de tipeo; el refresh dura 14 días, así que el login es raro.
 *
 * El contador vive en memoria, por proceso. ADR-008 despliega un solo contenedor; con dos
 * réplicas el límite efectivo se duplica, que es aceptable para lo que protege.
 *
 * Depende de `trust proxy` (ver `TRUST_PROXY` en `env.ts`). Detrás del balanceador de la
 * plataforma y sin esa configuración, todos los requests llegan con la IP del balanceador:
 * el límite pasa a ser GLOBAL y 30 intentos de cualquiera bloquean el login de todos.
 */
export const RATE_LIMITED_ROUTES = [
  { path: '/auth/sign-in', limit: 30, windowMinutes: 15 },
  // Una invitación se acepta una vez por persona: diez es holgado para una planta entera.
  { path: '/auth/invitations/accept', limit: 10, windowMinutes: 15 },
] as const;

/** Los pares `[ruta, middleware]` para montar con `app.use`. */
export function authRateLimits(): [path: string, handler: RequestHandler][] {
  return RATE_LIMITED_ROUTES.map(({ path, limit, windowMinutes }): [string, RequestHandler] => [
    path,
    rateLimit({
      windowMs: windowMinutes * 60_000,
      limit,
      // Solo el POST cuenta. El preflight `OPTIONS` lo contesta CORS antes, pero que el
      // conteo no dependa del orden en que se montó cada middleware.
      skip: (request) => request.method !== 'POST',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Con código en el cuerpo, como todo error de esta API: el cliente mapea el código
      // y no el texto (`SignInRoute/presentation.ts`).
      message: {
        code: 'rate_limited',
        message: 'Too many attempts from this network. Wait a few minutes and try again.',
      },
    }),
  ]);
}
