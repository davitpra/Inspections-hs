## 1. Contratos

**Sin migración**: `app_user`, `user_site_scope` y `user_invitation` ya existen con sus
`GRANT` y sus políticas RLS (`0005_identity.sql`). Este change no toca el esquema, así que no
lleva SQL.

- [x] 1.1 `packages/contracts/src/identity.ts`: `personAccountSchema` con `id`, `role`,
      `active` y `can_sign_in`, y nada más (design D2). Comentar por qué no lleva email ni
      alcance.
- [x] 1.2 `personWithAccountSchema` = `personSchema` más `account: personAccountSchema | null`,
      y el tipo que devuelve la ruta del roster. `personSchema` no se toca: lo usan el
      selector de sujeto y el paquete de campo.
- [x] 1.3 `createAccountRequestSchema` a partir del `createAccountSchema` que ya existe, más
      el flag que pide la invitación en el mismo acto (design D4), y su respuesta: la cuenta
      creada más el token de un solo uso cuando se invitó.
- [x] 1.4 Tests de contrato: rechaza `external_auditor` sin su ventana de fechas, rechaza
      `site_ids` vacío, y el token es opcional en la respuesta solo cuando no se invitó.

## 2. API — la lectura

- [x] 2.1 `apps/api/src/roster/roster.repository.ts`: `LEFT JOIN app_user` sobre `person`, con
      `can_sign_in` derivado de la existencia de una `app_credential` activa. El aislamiento
      lo sigue dando la política sobre `person` (ADR-002; ningún `WHERE site_id` en la query).
- [x] 2.2 `roster.service.ts` / `roster.controller.ts`: la respuesta pasa a
      `PersonWithAccount[]`. El chequeo de rol `hs_coordinator` no cambia.
- [x] 2.3 Test de integración: una persona con cuenta vuelve con su rol; una sin cuenta vuelve
      con `null`; ninguna respuesta trae email, alcance ni token; una cuenta invitada y no
      aceptada vuelve con `can_sign_in` en falso, y en verdadero después de aceptar.

## 3. API — el alta y la invitación

- [x] 3.1 Extraer de `invitation.service.ts` la escritura de `user_invitation` a un método que
      reciba el `PoolClient` de una transacción en curso; `issue()` pasa a llamarlo dentro de
      su propio `asAdministrator`. Sin cambiar su comportamiento: los tests que ya existen
      quedan verdes tal como están.
- [x] 3.2 `apps/api/src/auth/account.service.ts`: crea `app_user` y sus `user_site_scope` —y la
      invitación cuando se pide— dentro de **una** `asAdministrator` (design D3 y D4). El rol
      del actor se comprueba acá; el alcance lo comprueba `HS002` y no se duplica en un `if`.
- [x] 3.3 `account.controller.ts`: `POST /accounts`, validando con el esquema de 1.3. Errores
      legibles para persona inexistente, persona que ya tiene cuenta y email tomado.
- [x] 3.4 Registrar el controller en `auth.module.ts`.
- [x] 3.5 `apps/api/scripts/create-account.mjs` pasa a usar el mismo servicio en vez de su
      propio SQL (design D6), sin cambiar su interfaz de línea de comandos ni su negativa a
      crear `external_auditor`. El `INSERT` se extrajo a `account.repository.ts` (funciones
      planas, sin DI) y el comando lo importa compilado desde `dist/`, ver design D6.
- [x] 3.6 Tests de integración: el alta escribe la entrada de auditoría en la cadena de la
      planta después del `COMMIT`; el coordinador de una planta invitando a la otra es frenado
      y **no deja ninguna fila**; una segunda cuenta para la misma persona se rechaza; la
      cuenta creada no puede iniciar sesión hasta aceptar la invitación; un rol que no es
      `hs_coordinator` es rechazado y no crea nada.

## 4. Web

- [x] 4.1 `apps/web/src/api/roster.ts`: `listPeople` parsea la forma nueva; `inviteAsJhscMember`
      hace el `POST /accounts` pidiendo la invitación, con el `site_id` que la pantalla está
      mirando (design D7).
- [x] 4.2 `query-keys.ts`: la clave del roster se invalida al invitar. Sin clave nueva para la
      mutación.
- [x] 4.3 `RosterRoute/presentation.ts`: cómo se lee la celda de rol —`ROLE_LABELS` de
      contracts, nunca una etiqueta inventada por la pantalla— y qué ofrece la fila según si
      hay cuenta, si puede entrar y si la persona está activa. Con su test.
- [x] 4.4 `RosterRoute/InviteButton.tsx` (o `PersonRow.tsx` si la fila termina con su propia
      mutación): tiene estado y `useMutation`, así que va en su archivo — `CLAUDE.md`, rutas
      grandes. Pide el email, invita, y muestra el link de un solo uso para copiar.
      El link se movió a `InvitationLink.tsx`, en `RosterConsole` y no en `InviteButton`:
      invitar invalida el roster y desmonta la fila que ofreció el botón, ver design D8.
- [x] 4.5 `RosterRoute/index.tsx`: la columna Role/Action en la tabla. Una persona inactiva no
      se invita.
- [x] 4.6 `routes/permissions.ts`: quién ve el botón. Sale del archivo único de permisos de UI,
      no de un `role ===` en la ruta.
- [x] 4.7 Tests de ruta: el rol se muestra con su etiqueta de dominio ("JHSC member", nunca
      `jhsc_member`); una persona sin cuenta ofrece el botón y una con cuenta no; invitar
      vuelve a pedir el roster; el token se muestra una vez y no queda en la caché; ninguna
      pantalla muestra un uuid.

## 5. Cierre

- [x] 5.1 README: la sección "Dar de alta a alguien" gana el camino por la pantalla y aclara
      para qué sigue estando el comando (los otros roles, y el arranque sin coordinador).
- [x] 5.2 `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test` y
      `pnpm --filter api test:int` en verde.
- [x] 5.3 `openspec validate --changes roster-role-column-and-jhsc-invitation --strict`.
