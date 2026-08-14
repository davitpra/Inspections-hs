## 1. Servidor — un solo token vivo por cuenta

- [x] 1.1 En `InvitationService.issue()` (`apps/api/src/auth/invitation.service.ts`),
      dentro de la `asAdministrator` que ya abre y antes del `INSERT` de
      `writeInvitation()`, revocar las pendientes de esa cuenta:
      `UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND accepted_at IS
      NULL AND revoked_at IS NULL`. Sin tocar `writeInvitation()` (design D1). Sin
      migración: el permiso de `UPDATE` sobre `user_invitation` ya está concedido y ya lo
      usa `revoke()`.
- [x] 1.2 Extraer esa consulta a `revokePending(client, userId)` (design D5) y hacer que
      `issue()` la llame en vez de tener el `UPDATE` inline, para que
      `AccountService.update()` (grupo 4) la comparta sin escribirla dos veces.

## 2. Integración (API) — invitación

- [x] 2.1 En `apps/api/test/authentication.int-spec.ts`, test: invitar, reemitir con
      `stack.invitations.issue`, y verificar que aceptar el token ANTERIOR falla sin crear
      `app_credential` y que el NUEVO sí crea la credencial.
- [x] 2.2 Test: la fila de la invitación anterior sigue existiendo con `revoked_at` no
      nulo (ADR-002, nunca DELETE).
- [x] 2.3 Test: reemitir sobre una cuenta que ya tiene credencial activa se rechaza y no
      escribe ninguna fila; reemitir desde un rol que no es `hs_coordinator` se rechaza.

## 3. Contracts

- [x] 3.1 `accountDetailSchema` en `packages/contracts/src/identity.ts`:
      `personAccountSchema.extend({ email: emailSchema })`. Exportar `AccountDetail`.
- [x] 3.2 `updateAccountRequestSchema`: `{ email: emailSchema.optional(), invite:
      z.boolean().optional() }` con el mismo `.refine` de "algo tiene que cambiar" que ya
      usa `updateAccountSchema`. Se define aparte de `updateAccountSchema` — ese lleva
      `role` y `deactivated`, que esta ruta no expone (design D5/Non-Goals). Exportar
      `UpdateAccountRequest`.
- [x] 3.3 Casos en `identity.test.ts`: `accountDetailSchema` rechaza campos extra
      (`strictObject`); `updateAccountRequestSchema` rechaza el objeto vacío y acepta
      `{ invite: true }` solo o `{ email }` solo.

## 4. Servidor — lectura y corrección de cuenta

- [x] 4.1 `AccountService.find(actor, personId)` en `account.service.ts`: solo
      `hs_coordinator`; consulta `app_user` unida a `person` (RLS de `person` da el
      aislamiento — mismo criterio que `findRoster`, design D6); devuelve
      `AccountDetail | null`.
- [x] 4.2 `GET /accounts/:id` en `account.controller.ts`, vía `db.withSessionClient` (es
      lectura, no dispara el fanout de auditoría — no hace falta `asAdministrator`).
- [x] 4.3 `AccountService.update(actor, personId, request)`: una sola `asAdministrator`,
      orden fijado en design D5 — cargar cuenta → rechazar si `credentials.hasActive` →
      si vino `email` distinto, `checkEmailAvailable` (excluyendo la propia cuenta) +
      `UPDATE app_user SET email = $1` → si `invite`, `revokePending` +
      `invitations.writeInvitation`. Reusa `checkEmailAvailable` de `account.service.ts`
      ampliándola para excluir la cuenta propia.
- [x] 4.4 `PATCH /accounts/:id` en `account.controller.ts`, parseando con
      `updateAccountRequestSchema`.

## 5. Integración (API) — corrección de correo

- [x] 5.1 En `apps/api/test/account-creation.int-spec.ts`: reemitir con `email` nuevo
      cambia `app_user.email`, revoca la invitación anterior y el token nuevo acepta —
      todo en el mismo `COMMIT`.
- [x] 5.2 Test: existe una entrada `user.email_changed` con el valor anterior y el nuevo
      en la cadena de cada planta del alcance de la cuenta.
- [x] 5.3 Test: un `email` que ya es de otra cuenta se rechaza y no queda nada escrito (ni
      el email, ni una invitación nueva, ni revocada la vieja).
- [x] 5.4 Test: una cuenta con credencial activa rechaza tanto reemitir como corregir el
      correo en el mismo request.
- [x] 5.5 Test: `GET /accounts/:id` de una cuenta de otra planta no devuelve nada; ningún
      rol que no sea `hs_coordinator` la lee.

## 6. Cliente de API

- [x] 6.1 `getAccount(userId)` en `apps/web/src/api/roster.ts`, `GET /accounts/:id`
      parseado con `accountDetailSchema`.
- [x] 6.2 Reescribir `reissueInvitation` para pegar a `PATCH /accounts/:id` con
      `{ email?, invite: true }`, parseado con `createAccountResponseSchema` (la misma
      forma `{ account, invitation? }` que ya usa `inviteAsJhscMember`).
- [x] 6.3 `queryKeys.account(userId)` en `query-keys.ts`.

## 7. Pantalla del roster

- [x] 7.1 `presentation.ts`: `canReissueInvitation(person)` —cuenta no nula, activa y
      `can_sign_in` falso— y `reissueButtonLabel(person)`. Sin cambios en este grupo: la
      afordancia sigue decidida por lo que ya trae `GET /people`.
- [x] 7.2 `ReissueDialog.tsx`: agrega `useQuery(queryKeys.account(userId), () =>
      getAccount(userId))` para precargar el campo `Email` (editable, con la nota
      "Currently registered. Edit to correct it."); el botón de emitir queda deshabilitado
      mientras esa consulta no resolvió. Envía `email` solo si el valor cambió respecto al
      precargado.
- [x] 7.3 `index.tsx`: estado `reissuing` en `RosterConsole`, botón `New link` en la celda
      Role. Sin cambios en este grupo.

## 8. Test de la ruta

- [x] 8.1 En `index.test.tsx`: afordancias por fila (`New link` vs `Invite to JHSC` vs
      ninguno) según `can_sign_in`/cuenta.
- [x] 8.2 Reescribir el test de flujo de reemisión: mockear `getAccount` con el email
      actual, verificar que el campo aparece precargado, editarlo, confirmar, y verificar
      que `reissueInvitation`/`PATCH` recibe el `email` nuevo y que aparece
      `Copy invitation link` con el token.
- [x] 8.3 Test: dejar el campo sin tocar reemite sin mandar `email` (o mandándolo igual al
      actual — lo que decida 6.2, pero sin falsos "email changed").

## 9. Cierre

- [x] 9.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`, y la integración de
      `apps/api`.
- [x] 9.2 Manual con `pnpm dev` y sesión de coordinador: invitar con un correo mal escrito
      a propósito, cerrar sin copiar, reemitir desde la fila, ver el correo equivocado
      precargado, corregirlo, emitir, y aceptar la invitación con el link nuevo.
- [ ] 9.3 `/opsx:archive` — sincroniza el delta de `identity` a `openspec/specs/`.
