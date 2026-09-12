## 1. Contratos

- [x] 1.1 En `packages/contracts/src/identity.ts`, agregar `demote_to: z.literal('jhsc_member').optional()`
      a `updateAccountRequestSchema` (design D1) y ampliar el `refine` de exclusividad: `promote_to`
      y `demote_to` son actos solitarios, no se combinan entre sí ni con `deactivated`, `email` o
      `invite`. Actualizar el comentario de cabecera del schema: los actos pasan a ser cuatro.
- [x] 1.2 En `packages/contracts/src/identity.test.ts`, agregar casos: `demote_to` solo es válido;
      combinado con `promote_to`, `deactivated`, `email` o `invite` se rechaza; `demote_to` con
      otro valor que `jhsc_member` se rechaza.

## 2. API

- [x] 2.1 En `apps/api/src/auth/account.errors.ts`, agregar `account_demotion_forbidden` (403),
      `account_role_not_demotable` (409, nombra el rol actual), `account_demotion_inactive` (409) y
      `account_demotion_self` (403), con sus miembros en `AccountErrorCode` (design D3).
- [x] 2.2 En `apps/api/src/auth/account.service.ts`, extraer de `promote()` la lectura del objetivo
      (`FOR UPDATE OF u`, `active`, `can_sign_in`, `email`, `in_scope`) y las guardas comunes
      —no existe, fuera de alcance, uno mismo— en un helper; `promote()` queda con su rol de origen,
      su inactividad y su `UPDATE` (design D2). El error de "uno mismo" lo elige cada transición.
- [x] 2.3 En el mismo archivo, agregar `demote()`: rol de origen `hs_coordinator`
      (si no, `accountRoleNotDemotable(role)`), activa (si no, `accountDemotionInactive()`),
      `UPDATE app_user SET role = 'jhsc_member'`, `withdrawn: false` — sin revocar sesiones (design D4).
- [x] 2.4 En `update()`, rechazar `demote_to` a todo rol que no sea `management` antes de la
      transacción (`accountDemotionForbidden()`) y despacharlo a `demote()` dentro de
      `asAdministrator`, junto a `promote_to`. Actualizar los comentarios de `update()` y de
      `promote()` ("La única mutación de rol expuesta" deja de ser cierto).

## 3. API — tests de integración

- [x] 3.1 Crear `apps/api/test/account-demotion.int-spec.ts` siguiendo
      `account-promotion.int-spec.ts`: management degrada un coordinador de dos sitios y hay un
      `user.role_changed` con `previous_role: 'hs_coordinator'` y `role: 'jhsc_member'` en cada cadena;
      `person_id`, `email` y alcance intactos.
- [x] 3.2 En el mismo archivo: credencial y sesión viva siguen sin `revoked_at`, y el siguiente
      request de esa sesión se resuelve con `role: 'jhsc_member'` (el roster lo rechaza).
- [x] 3.3 En el mismo archivo: la cuenta degradada sigue en la lista de candidatos a inspector y
      se la puede asignar como `inspector_id`.
- [x] 3.4 En el mismo archivo, las guardas con su código y el rol sin cambiar: coordinador y
      miembro no pueden degradar; objetivo `jhsc_member` o `management`; objetivo inactivo; fuera
      de alcance; degradarse a sí mismo.
- [x] 3.5 En el mismo archivo: promover y luego degradar la misma cuenta deja dos
      `user.role_changed` por sitio, uno por cada cambio.

## 4. Web

- [x] 4.1 En `apps/web/src/api/roster.ts`, agregar `demoteToJhscMember({ userId })`, que envía
      `PATCH /accounts/:id` con `{ demote_to: 'jhsc_member' }`, junto a `promoteToCoordinator`.
- [x] 4.2 En `apps/web/src/permissions/session.ts`, agregar `canDemote` (solo `management`), con su
      caso en `session.test.ts` (design D6). Ajustar el comentario de `canPromote`: la asimetría
      pasa a ser decidir quién es coordinador.
- [x] 4.3 En `apps/web/src/routes/RosterRoute/presentation.ts`, agregar `canDemoteAccount` (cuenta
      activa `hs_coordinator`), `demoteButtonLabel`, el kind `'demote'` en `RosterActionKind`,
      `RosterDialog` y `dialogFor`, y el flag de degradación en `rowActions` junto a `mayPromote`.
      Casos en `presentation.test.ts` espejo de los de `canPromoteAccount` y `rowActions`.
- [x] 4.4 Crear `apps/web/src/routes/RosterRoute/DemoteDialog.tsx` a partir de `PromoteDialog.tsx`:
      "Demote {name} to JHSC member?", qué pierde (acceso administrativo desde su próxima acción)
      y qué conserva (sigue en el JHSC, mismo inicio de sesión, sitios y correo); botón
      "Demote to JHSC member". Invalida `queryKeys.roster(siteId)` y `queryKeys.account(userId)`.
- [x] 4.5 Cablear el diálogo en `RosterDialogs.tsx` y pasar `canDemote(account)` desde
      `RosterRoute/index.tsx` hasta `RosterTable.tsx` y `rowActions`.
- [x] 4.6 En `apps/web/src/routes/RosterRoute/index.test.tsx`, espejo de los tests de "Promote":
      management ve "Demote" en la fila de un coordinador activo, confirma y se llama
      `demoteToJhscMember`; un coordinador no ve la acción; una fila `jhsc_member` no la ofrece.

## 5. Documentación

- [x] 5.1 En `docs/Requisitos_V1.2.md` §4 (Roles y permisos), reemplazar "La promoción … es el
      único cambio de rol expuesto" por la promoción y su inversa, las dos exclusivas de
      `management`, y agregar la degradación a la fila de Gerencia.
