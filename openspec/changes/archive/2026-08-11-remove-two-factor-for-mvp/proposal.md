# Quitar el segundo factor del alcance del MVP

## Why

El segundo factor obligatorio no está terminado, y la forma en que no está terminado deja al
**coordinador —el rol que crea todas las demás cuentas— sin poder usar el sistema**.

Un `hs_coordinator` sin TOTP confirmado inicia sesión y recibe una sesión de propósito
`enrol_two_factor`: HTTP 200, tokens reales, y un guard que la rechaza en toda ruta que no sea la
inscripción del segundo factor. Eso es exactamente lo que `authentication-and-sessions` diseñó en
su D7, y del lado del servidor funciona. Lo que falta es la otra mitad: **las rutas
`POST /auth/two-factor/enrol` y `/confirm` no tienen ninguna interfaz que las llame.** No hay
pantalla de inscripción en `apps/web`, no la hubo nunca, y `apps/` no contiene otra aplicación.

El resultado observable hoy es peor que un rechazo limpio. `SignInRoute` detecta la sesión
limitada y muestra *"This account must enrol a second factor before it can be used. Do that on a
desktop browser, then sign in again here"*, pero **no borra los tokens que el cliente ya escribió
en Dexie**. Al recargar la página, `GET /auth/session` —que está en la lista blanca de la sesión
limitada, y debe estarlo— responde 200, el `Shell` comprueba solo que haya cuenta y nunca mira
`purpose`, y el coordinador entra a una aplicación donde cada pantalla de dominio recibe 403.
Además, "on a desktop browser" no tiene ninguna detección de plataforma detrás: el mismo texto
aparece en un escritorio, donde tampoco hay nada que hacer.

El coordinador de bootstrap que `004_bootstrap_coordinator.sql` siembra cae en este pozo en su
primer inicio de sesión. **Es la primera cuenta del sistema y hoy no sirve.**

Terminar el segundo factor cuesta una pantalla de inscripción con código QR, la confirmación, el
reinicio por el coordinador, y las pruebas de las tres. Es trabajo real sobre una superficie que
§2 no pidió para v1, mientras la etapa 8 —el builder visual— sigue abierta. La decisión es que
**el segundo factor sale del MVP**, y sale entero: sin capa muerta y sin bandera de configuración,
porque una capa apagada es una capa que hay que seguir manteniendo y probando.

Este change no cierra ninguna etapa de §7. Existe porque una etapa ya cerrada
—`authentication-and-sessions`— entregó una pieza a medio construir que bloquea el uso del
sistema, y el arreglo más barato es reducir el alcance en vez de completarla.

## Lo que se conserva, íntegro

La autenticación no se debilita en nada más que el factor que se quita. Siguen exactamente como
están:

- **El bloqueo por intentos fallidos.** El umbral, la ventana de enfriamiento y el reinicio del
  contador no se tocan. Lo único que desaparece es que un código TOTP incorrecto sumara al
  contador, porque ya no hay código.
- **La rotación de refresh tokens** con detección de reuso y su ventana de gracia.
- **Las cuentas solo por invitación.** ADR-011 sigue sin auto-registro: toda cuenta la crea el
  coordinador.
- **El alcance por sitio resuelto en cada request** contra `user_site_scope`, nunca congelado en
  el token.
- **El hasheo de contraseñas de `better-auth`** y el hook barrera que convierte un borrado de
  sesión en un `revoked_at`.
- **La revocación de sesiones y de credenciales por el coordinador.**

## Lo que este change NO es

**No es "el segundo factor nunca más".** Es un recorte de alcance de v1, no una decisión de
seguridad permanente. El día que se retome, se retoma completo —servidor **y** pantalla— y con la
propuesta que corresponda. Por eso el ADR-011 no se reescribe: se le agrega una nota de superación
que deja escrito qué quedó afuera y por qué.

**No es apagarlo con una bandera.** Vaciar `ROLES_REQUIRING_TWO_FACTOR` dejaría en pie el
servicio, la tabla, los tres endpoints, la rama del guard y el `purpose` de la sesión: una capa
entera sin usar, que igual hay que mantener compilando y probando, y que reintroduce el bug el día
que alguien vuelva a llenar el arreglo. Se quita de raíz.

**No es borrar la auditoría de lo que ya pasó.** Las entradas `two_factor.enrolled` y
`two_factor.reset` que hayan quedado en `audit_log` **sobreviven**. La cadena de auditoría no se
reescribe porque el producto cambie de opinión; eso es precisamente lo que ADR-002 puso la cadena
para impedir.

**No toca el bug del cliente por separado.** No hace falta: sin `purpose`, una sesión no nula es
siempre plena, y el gate `if (!account)` del `Shell` vuelve a ser correcto por construcción. El
arreglo del síntoma y la remoción de la causa son el mismo cambio.

## What Changes

- **La sesión pierde su `purpose`.** `app_session.purpose`, su `CHECK`, el tipo `SessionPurpose`
  y el campo del contrato desaparecen. Una sesión resuelta es una sesión plena; no hay segunda
  clase.
- **El guard pierde su segundo modo.** `ALLOWS_ENROLMENT_SESSION`, el decorador
  `@AllowsEnrolmentSession()` y la rama que lo consulta se van. El guard queda en su forma
  mínima: público → bearer → `resolve` → adjuntar. Las dos rutas que llevaban el decorador
  —`sign-out` y `GET /session`— siguen exigiendo sesión, como todas.
- **El inicio de sesión pierde el código.** `code` sale de `signInRequestSchema`, y con él
  `totpCodeSchema` y el campo del formulario. Iniciar sesión es email y contraseña.
- **Dos códigos de error salen del contrato**: `two_factor_required` y
  `two_factor_enrolment_required`. `invalid_credentials`, `account_locked`, `token_expired`,
  `session_ended`, `forbidden` e `invitation_invalid` se quedan.
- **Tres rutas dejan de existir**: `POST /auth/two-factor/enrol`, `/confirm` y `/reset`. La
  tercera era la única forma de que un coordinador rescatara a alguien que perdió su teléfono; sin
  segundo factor, no hay nada que rescatar.
- **La tabla `app_two_factor` se dropea**, con su índice parcial, sus cuatro triggers y su función
  de auditoría `hs_two_factor_audit()`. Es una tabla declarada inmutable por `0006`, y dropearla
  es una decisión deliberada que el design de este change justifica.
- **`hs_auth_guard()` se reemite** sin la rama de `app_two_factor` y sin `'purpose'` entre las
  columnas congeladas de `app_session`. Es una función compartida por cinco tablas y ahora por
  cuatro; se reescribe entera porque omitir una rama de más rompería la inmutabilidad de otra
  tabla.
- **Sale una dependencia**: `@better-auth/utils`, que el proyecto usaba únicamente para generar y
  verificar TOTP. `better-auth` se queda: da el hasheo de contraseñas.

## Capabilities

### Modified Capabilities

- `identity`: pierde los dos requisitos del segundo factor —el mandato por rol con su sesión
  limitada, y el reinicio por el coordinador—. El requisito del bloqueo por intentos fallidos se
  queda tal cual. Dos requisitos vecinos pierden una frase cada uno: el del refresh ya no puede
  prometer que renueva "sin pedir la contraseña ni el segundo factor", y el del fin de sesión ya
  no puede listar "cuando se reinicia su segundo factor" entre las causas de revocación.
- `audit`: pierde el escenario de la inscripción y el reinicio, y la mención de esos eventos en la
  prosa del requisito de eventos de autenticación. El requisito de que un inicio de sesión fallido
  se registre sin registrar el secreto **se queda**, sin la categoría "invalid second-factor code"
  en su lista de motivos.

### New Capabilities

Ninguna.

## Impact

- **Esquema**: migración `0015_remove_two_factor.sql`. Dropea `app_two_factor`, dropea
  `hs_two_factor_audit()`, reemite `hs_auth_guard()` y quita la columna `purpose` de
  `app_session` con su `CHECK`. **Es la primera migración del proyecto que elimina una tabla.**
- **`packages/contracts`**: `auth.ts` pierde dos códigos de error, `totpCodeSchema`, el campo
  `code`, el campo `purpose`, los tres esquemas del bloque "Segundo factor" y
  `ROLES_REQUIRING_TWO_FACTOR` con su `requiresTwoFactor()`.
- **`apps/api/src/auth`**: se borra `two-factor.service.ts`. Se editan `auth.service.ts`,
  `auth.controller.ts`, `auth.guard.ts`, `auth.module.ts`, `auth.errors.ts` y `session.service.ts`
  —esta última en seis lugares, porque `purpose` viajaba por el `resolve`, el `issue`, el
  `toContractSession`, la rotación y la ventana de gracia—.
- **`apps/web`**: `SignInRoute.tsx` queda con dos campos. Tres fixtures de test pierden
  `purpose: 'full'`.
- **Tests**: se borran seis casos de `describe('el segundo factor')`, el de la revocación por
  reinicio y el de auditoría. La aserción de `'un external_auditor no puede administrar ninguna
  cuenta'` que usaba `twoFactor.reset` **se sustituye, no se borra**: la propiedad que prueba
  sigue siendo cierta y sigue habiendo verbos administrativos con los que probarla.
- **Dependencias**: sale `@better-auth/utils` de `apps/api`.
- **Documentación**: nota de superación en `docs/adr/011-authentication.md` y actualización de la
  fila correspondiente de `docs/requisitos-v1.2.md`. El ADR no se reescribe.
- **Lo que queda desbloqueado**: el coordinador de bootstrap puede iniciar sesión y usar el
  sistema por primera vez, y con él todo el flujo de invitaciones que depende de que exista un
  coordinador operativo.
