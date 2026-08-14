## Why

Cierra un hueco de la **etapa 2** (§7 — usuarios, auth, roster) que dejó abierto
`2026-08-14-roster-role-column-and-jhsc-invitation`: el link de invitación se muestra una
sola vez y, si el coordinador cierra el modal sin copiarlo —o el link vence antes de que la
persona lo use—, la pantalla no ofrece ninguna forma de emitir otro. La fila pasa a mostrar
`JHSC member (invited)` sin acción, porque la persona ya tiene cuenta y el botón de invitar
deja de aplicar. ADR-011 ya define el camino ("revocar y emitir otra") y el servidor ya lo
expone (`POST /auth/invitations`), pero la única forma de llegar a él es una terminal — el
mismo eslabón manual que aquel change vino a sacar.

## What Changes

- La columna Role del roster gana una segunda acción: **`New link`**, ofrecida cuando la
  persona tiene cuenta activa que **todavía no puede entrar** (`can_sign_in: false`). Emite
  una invitación nueva y muestra su token con el mismo banner de copiar-una-vez que ya
  existe.
- Emitir una invitación para una cuenta **revoca las que esa cuenta tenía pendientes**, en
  la misma transacción. Antes, insertar sin cerrar la anterior dejaba dos links válidos
  circulando si se apretaba dos veces. Después de este change, una cuenta tiene a lo sumo
  un token vivo, y el link perdido deja de servir en el momento en que se emite el
  reemplazo.
- **El diálogo de reemisión permite corregir el correo con el que la cuenta quedó
  registrada, en el mismo acto.** Es el motivo más común de reemitir: el correo estaba mal
  escrito y el primer link nunca llegó a destino. Reemitir sin poder corregirlo manda el
  link nuevo a la misma dirección equivocada. El diálogo precarga el correo actual —el
  roster no lo devuelve nunca (ver más abajo), así que hace falta una lectura propia— y el
  coordinador lo edita antes de emitir.
- Sin cambio de esquema. `@hs/contracts` gana dos schemas (`accountDetailSchema`,
  `updateAccountRequestSchema`) y la API gana `GET /accounts/:id` y `PATCH /accounts/:id`;
  `POST /auth/invitations` deja de ser lo que llama el roster —sigue existiendo para el
  bootstrap por terminal— y `PATCH /accounts/:id` pasa a ser el único camino de reemisión
  desde la pantalla, con o sin corrección de correo.

**Fuera de alcance**: el reinicio de contraseña de una cuenta que **sí** puede entrar
(revocar credencial + invitar de nuevo, design D9 del change archivado). Es una acción
destructiva sobre alguien que hoy trabaja, con otra confirmación y otro riesgo; sigue
viviendo en `pnpm auth:reset-password`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: la reemisión desde el roster pasa a ser un requisito de la pantalla —una
  cuenta invitada que nunca llegó a entrar SHALL poder recibir un link nuevo sin pasar por
  una terminal, y SHALL poder corregir en el mismo acto el correo con el que quedó
  registrada—, y "revocar y emitir otra" deja de ser dos actos del coordinador para ser uno
  solo del sistema: emitir revoca lo pendiente, de modo que nunca haya dos tokens vivos
  para la misma cuenta. Se agrega, además, que el coordinador SHALL poder leer el detalle
  administrable de una cuenta de su alcance —incluido el correo—, por una vía que no es el
  roster: el roster sigue sin devolver correos, alcance ni credencial de nadie.

## Impact

- `packages/contracts/src/identity.ts` — `accountDetailSchema` (la cuenta reducida más el
  correo) y `updateAccountRequestSchema` (`{ email?, invite? }`).
- `apps/api/src/auth/account.controller.ts` — `GET /accounts/:id` y `PATCH /accounts/:id`,
  nuevos.
- `apps/api/src/auth/account.service.ts` — `AccountService.find()` y `.update()`: cargar,
  rechazar si la cuenta ya tiene credencial activa, corregir el correo si vino y es
  distinto, revocar lo pendiente y emitir si se pidió — un solo `COMMIT`.
- `apps/api/src/auth/invitation.service.ts` — la revocación de pendientes se extrae a
  `revokePending()`, compartida por `issue()` y `AccountService.update()`.
- `apps/web/src/api/roster.ts` — `getAccount(userId)` y una `reissueInvitation` que ahora
  pega a `PATCH /accounts/:id` con `{ userId, email? }` en vez de `POST /auth/invitations`.
- `apps/web/src/routes/RosterRoute/ReissueDialog.tsx` — precarga el correo con
  `useQuery(getAccount)`, lo deja editable, manda solo lo que cambió.
- Tests: unitarios de la ruta y de `presentation` (sin cambios ahí — la afordancia sigue
  decidida por `can_sign_in`/`active`), de contracts, e integración sobre la corrección de
  correo, su auditoría y sus rechazos.
- Sin migración: el motor ya concede `UPDATE (email, …) ON app_user` y ya audita
  `user.email_changed` (`0005_identity.sql`); lo que faltaba era la ruta.
