## 1. Motor — la columna y su auditoría

- [x] 1.1 `apps/api/drizzle/0035_coordinator_jhsc_seat.sql`: `ALTER TABLE app_user ADD
    COLUMN jhsc_seat_granted_at timestamptz`, más
      `CHECK (jhsc_seat_granted_at IS NULL OR role = 'hs_coordinator')` (design D2). No se
      toca `hs_identity_guard()`: la columna no es de las que se asignan una sola vez.
- [x] 1.2 En la misma migración, `GRANT UPDATE (jhsc_seat_granted_at) ON app_user TO
    hs_app` — la tabla es parcialmente mutable y cada columna se concede a mano
      (`0005_identity.sql` §GRANTs, ADR-002).
- [x] 1.3 En la misma migración, `CREATE OR REPLACE FUNCTION hs_account_changed_audit()`
      **entera**, con sus cuatro ramas actuales más la quinta:
      `user.jhsc_seat_granted` / `user.jhsc_seat_withdrawn` con
      `jhsc_seat_granted_at` en el payload. Sin esto, la coordinadora se sienta sola y sin
      rastro.
- [x] 1.4 Entrada `idx: 34` en `apps/api/drizzle/meta/_journal.json`, y la columna + el
      `check` en `apps/api/src/db/schema/identity.ts`.
- [x] 1.5 `apps/api/test/helpers/identity.ts`: `AccountSpec` gana `jhscSeat?: boolean` para
      sembrar la coordinadora ya sentada.

## 2. Contratos

- [x] 2.1 `packages/contracts/src/identity.ts`: `personAccountSchema` gana
      `jhsc_seat: z.boolean()` — booleano derivado, nunca la fecha (design D6). Arrastra a
      `accountDetailSchema`, a `personWithAccountSchema` y a `createAccountResponseSchema`.
      `accountSchema` gana el mismo campo para que no queden dos formas de la misma cuenta.
- [x] 2.2 `updateAccountRequestSchema` gana `jhsc_seat: z.boolean().optional()` —booleano en
      los dos sentidos, y el comentario explica por qué NO es `z.literal` como
      `deactivated` (design D4)— más un `refine` que lo rechaza combinado con `deactivated`,
      `email` o `invite`.
- [x] 2.3 Tests en `packages/contracts/src/identity.test.ts`: el asiento solo en los dos
      sentidos, y los tres rechazos de la combinación.

## 3. Servidor — el acto

- [x] 3.1 `apps/api/src/auth/account.errors.ts`: error nuevo (409) para el rol que no puede
      ocupar un asiento, con su código en `AccountErrorCode`, al lado de
      `accountRoleNotRemovable`.
- [x] 3.2 `account.repository.ts` (`findAccountDetail`) y `roster/roster.repository.ts`
      (`findRoster`) proyectan `u.jhsc_seat_granted_at IS NOT NULL AS jhsc_seat` y lo mapean
      — en el roster, con el mismo cuidado del `LEFT JOIN` que ya tiene `account_active`.
- [x] 3.3 `AccountService.update()`: rama del asiento **antes** de las demás, y `seat()`
      junto a `withdraw()` — rechaza rol distinto de `hs_coordinator` y cuenta inactiva;
      `UPDATE app_user SET jhsc_seat_granted_at = CASE WHEN $2 THEN now() ELSE NULL END`.
      **No revoca sesiones ni credenciales** (design D5): el asiento no da ni quita acceso.
- [x] 3.4 Que `create()` y `find()` devuelvan el campo nuevo en su respuesta (una cuenta
      recién creada nunca tiene asiento).

## 4. Servidor — la elegibilidad

- [x] 4.1 `inspections/inspector-eligibility.ts`: `ACCOUNT_HOLDS_JHSC_SEAT` y
      `ACCOUNT_SITS_ON_JHSC` (los dos casos entre paréntesis, que es lo que la mezcla con
      `AND` exige), usado por `isEligibleInspector`. El comentario del módulo pasa a decir
      que el comité no es un rol.
- [x] 4.2 `inspections.service.ts` `requireInspector`: proyecta además
      `u.jhsc_seat_granted_at IS NOT NULL AS holds_seat` y conserva sus mensajes distintos —
      al coordinador sin asiento se le dice que le falta el asiento, no que su rol no sirve
      (design D3).

## 5. Web

- [x] 5.1 `apps/web/src/api/roster.ts`: `setJhscSeat({ userId, granted })` sobre
      `PATCH /accounts/:id`, al lado de `removeJhscAccess`.
- [x] 5.2 `RosterRoute/presentation.ts`: `canGrantJhscSeat` y `canWithdrawJhscSeat` (cuenta
      activa, `role === 'hs_coordinator'`, con y sin asiento), sus etiquetas accesibles con
      el patrón de `removeButtonLabel`, y la celda Role diciendo el asiento cuando lo hay.
- [x] 5.3 `RosterRoute/JhscSeatDialog.tsx`, modelado sobre `RemoveAccessDialog.tsx`. Al
      quitar, dice que las inspecciones ya asignadas siguen siendo suyas (design D7).
- [x] 5.4 `RosterRoute/index.tsx`: el estado del diálogo montado FUERA de la tabla —misma
      razón que `inviting`/`removing`— y el botón en la columna Actions.

## 6. Pruebas

- [x] 6.1 `apps/web/src/routes/RosterRoute/presentation.test.ts`: los dos predicados, la
      etiqueta de la celda, y que ningún otro rol los habilita.
- [x] 6.2 `apps/web/src/routes/RosterRoute/index.test.tsx`: sentarse y levantarse desde la
      fila propia, con su confirmación.
- [x] 6.3 `apps/api/test/jhsc-seat.int-spec.ts`: el `PATCH` otorga y quita, escribe
      `user.jhsc_seat_granted` / `user.jhsc_seat_withdrawn` en la cadena de CADA planta del
      alcance firmadas por la actora, rechaza un rol que no puede sentarse y una cuenta
      inactiva, y no toca credenciales ni sesiones.
- [x] 6.4 `apps/api/test/inspection-period.int-spec.ts`: la coordinadora con asiento aparece
      entre los candidatos y se le puede asignar; sin asiento no aparece y la asignación se
      rechaza con su mensaje propio; quitarle el asiento no cambia el `inspector_id` de lo
      ya asignado ni lo saca de sus pendientes.
- [x] 6.5 `apps/api/test/immutability.int-spec.ts`: `hs_app` puede escribir la columna nueva,
      y el `CHECK` rechaza el asiento sobre cualquier rol que no sea `hs_coordinator`.

## 7. Cierre

- [x] 7.1 `pnpm -r build && pnpm typecheck && pnpm lint`, `pnpm test` y los int-specs
      tocados.
- [x] 7.2 A mano: sentarse desde `/roster`, aparecer como candidata en `/scheduling`,
      capturar y enviar la inspección, y levantarse sin perder lo ya asignado.
