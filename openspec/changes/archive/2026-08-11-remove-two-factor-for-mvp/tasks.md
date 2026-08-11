## 1. El contrato

- [x] 1.1 `packages/contracts/src/auth.ts`: quitar `'two_factor_required'` y
      `'two_factor_enrolment_required'` de `AUTH_ERROR_CODES`. `authErrorCodeSchema` e
      `isRenewable` derivan del arreglo y no se tocan.
- [x] 1.2 Quitar `totpCodeSchema` y el campo `code` de `signInRequestSchema`. Iniciar sesión pasa
      a ser email y contraseña.
- [x] 1.3 Quitar `purpose` de `sessionSchema` y el párrafo del comentario de cabecera que lo
      justificaba ("una sesión limitada tiene que ser visible para el cliente").
- [x] 1.4 Borrar el bloque "Segundo factor" entero: `enrolTwoFactorResponseSchema`,
      `confirmTwoFactorRequestSchema`, `resetTwoFactorRequestSchema` y sus tipos.
- [x] 1.5 Borrar `ROLES_REQUIRING_TWO_FACTOR` y `requiresTwoFactor()`. `index.ts` reexporta
      `./auth.js` en bloque, así que no hay lista por símbolo que editar.

## 2. La API

- [x] 2.1 Borrar `apps/api/src/auth/two-factor.service.ts` entero.
- [x] 2.2 `auth.module.ts`: quitar el import y el provider de `TwoFactorService`.
- [x] 2.3 `auth.errors.ts`: borrar `twoFactorRequired()` y `twoFactorEnrolmentRequired()`.
      `accountLocked()` se queda.
- [x] 2.4 `auth.service.ts`: quitar los imports de `TwoFactorService` y `twoFactorRequired`, el
      parámetro del constructor, la rama de verificación del código y la resolución de `purpose`.
      `sessions.issue(account.id, meta)` queda sin el segundo argumento. Quitar `purpose` del
      payload de auditoría de `auth.signed_in`. **La llamada a `credentials.registerFailure` que
      vivía dentro de la rama del código desaparece con ella; el camino de contraseña incorrecta
      conserva la suya.**
- [x] 2.5 `auth.guard.ts`: borrar `ALLOWS_ENROLMENT_SESSION`, el decorador
      `AllowsEnrolmentSession()`, su bloque de comentario, el import de
      `twoFactorEnrolmentRequired` y la rama `purpose === 'enrol_two_factor'`. El guard queda:
      público → bearer → `resolve` → adjuntar al request.
- [x] 2.6 `auth.controller.ts`: borrar la sección "Segundo factor" con sus tres rutas
      (`two-factor/enrol`, `/confirm`, `/reset`), los imports asociados, el `TwoFactorService`
      inyectado y **el `DbService` inyectado, que existía solo para la consulta de email de la
      ruta de enrol**. Quitar los dos `@AllowsEnrolmentSession()` de `sign-out` y
      `GET /session`; ambas siguen exigiendo sesión.
- [x] 2.7 `session.service.ts`: quitar el hilo de `purpose` en sus seis lugares — el tipo
      `SessionPurpose`, el campo de `SessionContext` y de `ResolvedRow`, la columna del `SELECT`
      de `resolve()` y su mapeo, el parámetro de `issue()` y su uso en el `INSERT`, el campo de
      `toContractSession()`, y el arrastre en la rotación del refresh y en la ventana de gracia.

## 3. El esquema y la migración `0015_remove_two_factor.sql`

- [x] 3.1 `apps/api/src/db/schema/auth.ts`: borrar la tabla `appTwoFactor` con su índice parcial,
      la columna `purpose` de `appSession`, el `check` `app_session_purpose_check` y el tipo
      `SessionPurpose`. Corregir el comentario de cabecera que cuenta las tablas.
- [x] 3.2 Escribir `apps/api/drizzle/0015_remove_two_factor.sql` **a mano** (`drizzle-kit
      generate` sigue prohibido, ADR-004), con el comentario de cabecera en el formato del resto
      de las migraciones, declarando que es la primera migración del proyecto que elimina una
      tabla y por qué eso es aceptable acá (D1): el hecho auditable vive en `audit_log`, en otra
      tabla, y esta migración no lo toca.
- [x] 3.3 En la misma migración, `DROP TABLE app_two_factor;`. Los cuatro triggers
      (`_guard`, `_forbid_deletion`, `_forbid_truncate`, `_audit`), el índice parcial
      `app_two_factor_active_uq` y los `GRANT` caen con ella. Verificado que el proyecto no define
      event triggers de DDL que puedan bloquear el `DROP`.
- [x] 3.4 `DROP FUNCTION hs_two_factor_audit();` — no cae sola con la tabla.
- [x] 3.5 **`CREATE OR REPLACE FUNCTION hs_auth_guard()` reemitida entera** (D3): copiar el cuerpo
      literal de `0006`, borrar la rama `WHEN 'app_two_factor'` y sacar `'purpose'` del arreglo de
      `app_session`, sin tocar las ramas de `app_credential`, `user_invitation` ni
      `app_refresh_token`. Es la parte más delicada de la migración: perder una rama ajena deja
      esa tabla mutable **sin producir ningún error**.
- [x] 3.6 `ALTER TABLE app_session DROP CONSTRAINT app_session_purpose_check;` y
      `ALTER TABLE app_session DROP COLUMN purpose;`.
- [x] 3.7 Agregar la entrada a `apps/api/drizzle/meta/_journal.json` con la convención exacta del
      archivo: `{ "idx": 14, "version": "7", "when": 1754524800014, "tag":
      "0015_remove_two_factor", "breakpoints": true }`.

## 4. El web

- [x] 4.1 `apps/web/src/routes/SignInRoute.tsx`: borrar el estado `code`, su inclusión en el
      cuerpo de `signIn`, el campo del formulario, y los `case 'two_factor_required'` y
      `'two_factor_enrolment_required'` de `messageFor`.
- [x] 4.2 Borrar el bloque `if (result.value.purpose !== 'full')` con el mensaje de inscripción.
      **Es el mensaje que originó este change**, y su desaparición es el arreglo: el `submit`
      queda en error → mensaje, éxito → `reload()` + `navigate`.
- [x] 4.3 Reescribir el bloque de comentario de cabecera, que justifica en tres párrafos un campo
      de código que ya no existe. Lo que sigue siendo cierto y vale conservar: ADR-011 sin
      auto-registro, toda cuenta creada por invitación del coordinador.
- [x] 4.4 Quitar `purpose: 'full'` de las tres fixtures de sesión:
      `routes/ComplianceRoute.test.tsx`, `routes/ActionRoute.test.tsx` y
      `routes/incident-presentation.test.tsx`.
- [x] 4.5 **No tocar `app/router.tsx`.** Sin `purpose`, una sesión no nula es siempre plena y el
      gate `if (!account)` vuelve a ser correcto por construcción (D5). Confirmar leyéndolo, y
      dejar constancia de que se leyó.

## 5. Los tests

- [x] 5.1 `apps/api/test/helpers/auth.ts`: quitar el import de `createOTP` y de
      `TwoFactorService`, el campo `twoFactor` de `AuthStack`, su instanciación, su paso a
      `AuthService` y su retorno. Borrar los helpers `totpFor()` y `activeSecret()`.
- [x] 5.2 `apps/api/test/authentication.int-spec.ts`: borrar el import de `totpFor`, el
      `describe('el segundo factor')` completo con sus seis casos, el caso `'reiniciar el segundo
      factor termina las sesiones vivas'` y el caso de auditoría `'el segundo factor deja entrada
      al confirmarse y al reiniciarse'`.
- [x] 5.3 En `'un external_auditor no puede administrar ninguna cuenta'`, **sustituir** la
      aserción que usa `stack.twoFactor.reset(...)` por otra sobre un verbo administrativo que
      sobrevive —`invitations.issue` o `sessions.revokeAllForUser`—. El caso prueba que el auditor
      externo no administra cuentas, y esa propiedad sigue siendo cierta: no se borra la
      aserción, se reapunta.
- [x] 5.4 Retitular `'renueva sin contraseña ni segundo factor'` a `'renueva sin contraseña'`. El
      cuerpo no tiene llamadas de 2FA y no cambia.
- [x] 5.5 Dejar `apps/api/test/identity.int-spec.ts` intacto. Su regex que prohíbe
      `totp|otp|secret` en el esquema pasa más fácil después de esto: es un test que **valida** la
      remoción, no una víctima de ella.

## 6. Dependencias y documentación

- [x] 6.1 Quitar `"@better-auth/utils"` de `apps/api/package.json` y correr `pnpm install`. Era la
      única dependencia dedicada al TOTP y sus tres sitios de import desaparecen. **`better-auth`
      se queda**: da el hasheo de contraseñas y el hook barrera de borrado de sesión.
- [x] 6.2 `docs/adr/011-authentication.md`: agregar una nota de superación fechada al comienzo.
      **No reescribir el cuerpo del ADR**: el D7 que describe fue una decisión real y sigue siendo
      el registro de lo que se decidió entonces.
- [x] 6.3 Actualizar la fila de la tabla de requisitos de `docs/` que menciona "TOTP para
      coordinador y gerencia" (verificar el nombre exacto del archivo antes de editar).

## 7. La verificación

- [x] 7.1 `pnpm typecheck` limpio. Es la red principal (D6): sin `purpose` en `sessionSchema` ni
      `code` en `signInRequestSchema`, todo consumidor sobreviviente falla a compilar en API y en
      web.
- [ ] 7.2 `pnpm lint` limpio — caza imports y variables que quedaron sin uso tras las ediciones
      quirúrgicas. **NO PASA, y no por este change**: el único error es `statSync` sin usar en
      `apps/web/scripts/check-tokens.mjs`, un archivo ajeno a esta remoción que ya fallaba antes.
      Ningún archivo tocado acá produce hallazgos. Queda sin marcar para que el bloqueo siga
      visible hasta que ese archivo se arregle.
- [x] 7.3 `pnpm test` — unitarios de contracts y web.
- [x] 7.4 `pnpm db:reset && pnpm db:migrate && pnpm db:seed` corre sin error: prueba que `0015`
      aplica sobre `0006`.
- [x] 7.5 Contra la base migrada: `app_two_factor` no existe; `app_session` no tiene `purpose`;
      `SELECT proname FROM pg_proc WHERE proname = 'hs_two_factor_audit'` devuelve cero filas.
- [x] 7.6 **La comprobación crítica de 3.5**: un `UPDATE app_session SET token = ...` sigue
      fallando con `HS001`, y lo mismo para una columna congelada de `app_credential`,
      `user_invitation` y `app_refresh_token`. Confirma que la `hs_auth_guard()` reemitida no
      perdió ninguna rama ajena.
- [x] 7.7 `pnpm --filter api test:int` — cubre bloqueo por intentos, rotación de refresh,
      revocación, alcance por sitio y auditoría sobre un contenedor limpio.
- [x] 7.8 **End-to-end, el caso que originó el change**: `pnpm auth:bootstrap`, aceptar la
      invitación, e iniciar sesión como coordinador en el web. Debe entrar **en el primer
      intento**, sin mensaje, y las pantallas de dominio deben responder 200 en vez de 403.
      Recargar y seguir adentro.
