## 1. Esquema

- [x] 1.1 Escribir `apps/api/drizzle/0047_jhsc_membership_by_role.sql` con el orden que fija el
      design D5, en cinco statements separados por `--> statement-breakpoint`:
      (a) `CREATE OR REPLACE FUNCTION hs_account_changed_audit()` entera, con las tres ramas de
      `0046` (`role`, `email`, `deactivated_at`) y **sin** la de `jhsc_seat_granted_at` — va primero
      porque Postgres registra la dependencia del cuerpo con la columna;
      (b) `ALTER TABLE app_user DROP CONSTRAINT app_user_jhsc_seat_check;`
      (c) `REVOKE UPDATE (email, role, deactivated_at, jhsc_seat_granted_at) ON app_user FROM hs_app;`
      (d) `ALTER TABLE app_user DROP COLUMN jhsc_seat_granted_at;`
      (e) `GRANT UPDATE (email, role, deactivated_at) ON app_user TO hs_app;`
      El comentario de cabecera dice por qué no hay política RLS que tocar (`app_user` no tiene sitio,
      tiene alcance — `0005` §10), que `hs_identity_guard` queda intacto, y que los tipos de evento
      `user.jhsc_seat_granted` / `user.jhsc_seat_withdrawn` no se retiran de ningún catálogo porque
      no existe tal catálogo y la cadena ya tiene entradas históricas inmutables.
- [x] 1.2 Agregar la entrada `idx: 46`, `tag: "0047_jhsc_membership_by_role"` a
      `apps/api/drizzle/meta/_journal.json`.
- [x] 1.3 Quitar de `apps/api/src/db/schema/identity.ts` la columna `jhscSeatGrantedAt`, el
      `check('app_user_jhsc_seat_check', …)` y `jhsc_seat_granted_at` de `AppUserUpdate`.

## 2. Contratos

- [x] 2.1 En `packages/contracts/src/identity.ts`, quitar `jhsc_seat` de `personAccountSchema` y de
      `accountSchema`, con el comentario que lo explicaba.
- [x] 2.2 En el mismo archivo, quitar `jhsc_seat` de `updateAccountRequestSchema`, borrar el `refine`
      del acto solitario del asiento y la mención del asiento en el `refine` de `promote_to`.
      Actualizar el comentario de cabecera del schema: los actos que quedan son email + invite,
      `deactivated: true` y `promote_to`.
- [x] 2.3 Ajustar `packages/contracts/src/identity.test.ts`: se retiran los casos del asiento y se
      agrega uno que afirma que un update con `jhsc_seat` ahora es rechazado por `strictObject`.

## 3. API — elegibilidad como inspector

- [x] 3.1 En `apps/api/src/inspections/inspector-eligibility.ts`, retirar `ACCOUNT_IS_JHSC_MEMBER`,
      `ACCOUNT_HOLDS_JHSC_SEAT` y `ACCOUNT_SITS_ON_JHSC`; `isEligibleInspector` queda en
      `ACCOUNT_IS_ACTIVE AND siteScopeIsActive(param)`. Reescribir el comentario de cabecera: hoy
      explica por qué la pregunta pasó del rol al asiento; pasa a explicar por qué volvió al rol y
      por qué el módulo sigue existiendo con dos condiciones (design D2).
- [x] 3.2 En `apps/api/src/inspections/inspections.service.ts`, sacar de `requireInspector` la
      proyección del rol y del asiento y la rama que los juzga; quedan los dos rechazos de la spec
      ("does not exist or is deactivated", "has no active access to site"). Actualizar el comentario
      que justificaba tres mensajes (design D3) y quitar los imports que quedan sin uso.
- [x] 3.3 Precisar el comentario colgado de `apps/api/src/db/schema/inspections.ts:60`, que todavía
      dice "Que el inspector sea `jhsc_member`…", anterior al asiento.

## 4. API — el acto del asiento

- [x] 4.1 En `apps/api/src/auth/account.service.ts`, borrar `seat()` y su despacho en `update()`, y
      quitar `jhsc_seat` de las respuestas de `create`, `withdraw`, `revive` y `promote`.
- [x] 4.2 En `apps/api/src/auth/account.errors.ts`, borrar `accountRoleWithoutJhscSeat` y su miembro
      de la unión de códigos.
- [x] 4.3 En `apps/api/src/auth/account.repository.ts`, quitar la proyección
      `u.jhsc_seat_granted_at IS NOT NULL AS jhsc_seat` y el campo del tipo de fila.
- [x] 4.4 En `apps/api/src/roster/roster.repository.ts`, quitar la proyección, el campo del tipo de
      fila, el mapeo hacia el contrato y el comentario que describía el asiento.

## 5. Web

- [x] 5.1 Borrar `apps/web/src/routes/RosterRoute/JhscSeatDialog.tsx` y su cableado en
      `RosterDialogs.tsx` y en `RosterRoute/index.tsx` (estado del diálogo y mutación).
- [x] 5.2 En `apps/web/src/routes/RosterRoute/presentation.ts`, borrar `jhscSeatAction`,
      `jhscSeatButtonText` y `jhscSeatButtonLabel`, el valor `'seat'` de `RosterActionKind`, el campo
      `seat` de `RosterRowAction` y la rama del asiento en `rowActions`; `accountRoleLabel` pierde el
      sufijo `· JHSC seat` y vuelve a ser `ROLE_LABELS[role]` más el `(invited)`.
- [x] 5.3 En `apps/web/src/api/roster.ts`, borrar `setJhscSeat`.
- [x] 5.4 Ajustar `RosterRoute/presentation.test.ts` e `index.test.tsx`: se retiran los casos del
      botón y del sufijo, y se conserva uno que afirma que una fila de coordinador ya no ofrece
      ningún acto de asiento.

## 6. Tests de integración

- [x] 6.1 Borrar `apps/api/test/jhsc-seat.int-spec.ts` entero: afirma un acto que deja de existir.
- [x] 6.2 Quitar el parámetro `jhsc_seat_granted_at` del helper de `apps/api/test/helpers/identity.ts`
      y ajustar sus llamadas en `identity.int-spec.ts`, `roster-administration.int-spec.ts` y
      `scheduling-console.int-spec.ts`.
- [x] 6.3 En `apps/api/test/inspection-period.int-spec.ts`, retirar los casos de rechazo por asiento
      y agregar el de una cuenta `management` con alcance vigente aceptada como `inspector_id`.
- [x] 6.4 En `apps/api/test/account-promotion.int-spec.ts`, agregar el caso que motiva el change:
      una cuenta `jhsc_member` activa que figura entre los candidatos a inspector de su planta sigue
      figurando después de ser promovida, sin acto intermedio.
- [x] 6.5 Comprobar que `apps/api/test/reduce-roles-migration.int-spec.ts` no afirma nada sobre la
      columna retirada y ajustarlo si lo hace.

## 7. Documentación

- [x] 7.1 Escribir `docs/adr/023-membresia-jhsc-por-rol.md`: por qué existió el asiento (`0035`), por
      qué derivar la membresía del rol lo reemplaza, y que la retirada pone a una cuenta `management`
      al alcance de una asignación de inspección — la consecuencia declarada en design D6. Agregarlo
      al índice de `docs/adr/README.md`.
- [x] 7.2 En `docs/Requisitos_V1.2.md` §4, retirar la oración "No concede un asiento en el JHSC como
      efecto lateral" y dejar dicho que la membresía del comité sigue al rol.
