## 1. Contracts

- [x] 1.1 `updateAccountRequestSchema` (`packages/contracts/src/identity.ts`) gana
      `deactivated: z.boolean().optional()`, más un segundo `.refine` que rechaza
      `deactivated: true` combinado con `email` o `invite` (design D6). `role` sigue sin
      exponerse: por esta ruta se administra el acceso, no el rol.
- [x] 1.2 Tests en `identity.test.ts`: baja sola, restitución con `invite` y con `email`, y
      los dos rechazos de la combinación contradictoria.

## 2. Servidor — la escritura

- [x] 2.1 Extraer `revokeCredentials(client, userId)` de `CredentialService.revoke()`
      (`credential.service.ts`) como función libre, mismo patrón que `revokePending`, para
      que entre en la transacción del llamador. `revoke()` pasa a usarla.
- [x] 2.2 `account.errors.ts`: `accountRoleNotRemovable()` (403) y
      `accountAlreadyInactive()` (409), con sus códigos en `AccountErrorCode`.
- [x] 2.3 En `AccountService.update()`, bajar la guarda `can_sign_in` de la ruta a los actos
      de `email`/`invite` (design D5). Es lo que permite quitarle el acceso a quien ya
      entra, que es el caso principal.
- [x] 2.4 `withdraw(client, existing)`: rechaza rol distinto de `jhsc_member` y cuenta ya
      inactiva; `revokePending`, `revokeCredentials`, `UPDATE app_user SET deactivated_at =
    now()`. **NO toca `user_site_scope`** (design D2).
- [x] 2.5 `revive(client, existing, request)` en `create()`: `checkNoExistingAccount` pasa a
      ser `findAccountOfPerson`, y una cuenta inactiva **del mismo rol** se reactiva
      (`deactivated_at = NULL`, el correo del alta, el alcance que falte) en vez de rechazar
      con `account_already_exists` (design D4). `update()` NO restituye: `PATCH` solo da de
      baja, y el contrato lo dice con `z.literal(true)`.
- [x] 2.6 Revocar sesiones con `sessions.revokeAllForUser(accountId,
    'account_deactivated')` **después** del COMMIT y sin pasarle cliente (design D3).
      Inyectar `SessionService` en `AccountService`.

## 3. Integración (API)

- [x] 3.1 `apps/api/test/account-removal.int-spec.ts` nuevo. `user.deactivated` existe en la
      cadena de CADA planta del alcance y `actor_user_id` es el COORDINADOR — los dos
      lados de D2/D3, que es lo único que prueba que las transacciones están en el orden
      correcto.
- [x] 3.2 Test: `user_site_scope` sigue con `revoked_at` nulo después de la baja, y la
      cuenta queda inactiva igual.
- [x] 3.3 Test: la invitación pendiente queda revocada y su token deja de aceptar; la
      credencial y las sesiones de un miembro que entraba quedan revocadas y no puede volver
      a iniciar sesión.
- [x] 3.4 Tests de permiso: otro rol → `account_forbidden`; coordinador de otra planta →
      `account_not_found`; rol que no es `jhsc_member` → `account_role_not_removable`; dos
      bajas → `account_already_inactive` sin pisar la fecha.
- [x] 3.5 Tests de volver a invitar: `create()` sobre una persona con cuenta inactiva
      devuelve la misma `id`, con el alcance intacto y `user.reactivated` en las dos
      cadenas; el link nuevo crea credencial; el correo del alta reemplaza al anterior; una
      cuenta ACTIVA sigue dando `account_already_exists`, y una inactiva de otro rol
      también.
- [x] 3.6 Test de no-regresión de D5: reemitir a quien ya entra se sigue rechazando, pero
      quitarle el acceso se permite.

## 4. Cliente

- [x] 4.1 `apps/web/src/api/roster.ts`: `removeJhscAccess({userId})` sobre
      `PATCH /accounts/:id`. `inviteAsJhscMember` no cambia — ya hace lo que volver a
      invitar necesita.
- [x] 4.2 `presentation.ts`: `canRemoveJhscAccess`, `removeButtonLabel`, `removeButtonText` y
      `showsAccountRole`. `canInvite` pasa a admitir también a quien tiene una cuenta
      inactiva de `jhsc_member`, y `accountRoleLabel` se queda con sus dos casos: una cuenta
      dada de baja no llega hasta ahí.
- [x] 4.3 `RemoveAccessDialog.tsx`: confirmación, con el texto y el botón cambiando según
      `canSignIn` (design D1/D8). Sin token. Se cierra solo al terminar.
- [x] 4.4 `index.tsx`: el estado `removing` (con su `canSignIn`) montado fuera de la tabla, el
      botón de quitar en la celda Role/Action, y la etiqueta del rol solo cuando la cuenta
      está activa.

## 5. Tests del cliente

- [x] 5.1 `presentation.test.ts`: cada afordancia; que invitar no convive con quitar ni con
      reemitir; que reemitir y cancelar SÍ conviven sobre una invitación pendiente; y que la
      fila sin acceso se comporta igual haya tenido cuenta o no.
- [x] 5.2 `index.test.tsx`: qué ofrece cada estado de fila, que la confirmación no llama al
      servidor hasta confirmar, que el texto habla de sesiones o de links según el caso, que
      la fila que queda no muestra ningún rol y ofrece invitar, y que volver a invitar pasa
      por `inviteAsJhscMember` con el correo pedido de cero.

## 6. Cierre

- [x] 6.1 `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`.
- [x] 6.2 Prueba manual con `pnpm dev`: invitar, cancelar, comprobar que el link viejo ya no
      abre `/accept-invitation`, restituir y aceptar con el nuevo.
- [x] 6.3 `/opsx:archive` — sincronizar el delta a `openspec/specs/identity/spec.md`.
