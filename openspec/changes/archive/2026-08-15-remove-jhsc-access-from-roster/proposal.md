## Why

El roster sabe **dar** acceso y sabe **reemitir** el link, pero no sabe quitarlo. Después de
`2026-08-14-reissue-invitation-link-from-roster`, la celda Role ofrece exactamente dos
actos: invitar a quien no tiene cuenta, y `New link` a quien la tiene y todavía no puede
entrar. No hay un tercero, y eso deja dos huecos que el coordinador vive todos los días:

- **Una invitación no se cancela.** Se invita al correo equivocado, o a la persona
  equivocada de dos homónimas, y lo único disponible es reemitir — que revoca el link
  anterior pero deja la cuenta viva y la invitación abierta. `InvitationService.revoke` y
  `POST /auth/invitations/revoke` existen desde la etapa de auth, pero piden el
  `invitation_id`, que el roster nunca devuelve, y ninguna pantalla los llama.
- **A un miembro del JHSC no se le quita el acceso.** El comité rota: alguien deja el
  comité, cambia de planta o se va de la empresa. No hay ninguna ruta que ponga
  `app_user.deactivated_at` — el `GRANT UPDATE` está concedido desde `0005_identity.sql` y
  nunca tuvo endpoint. Hoy se hace con `psql`, que es el mismo eslabón manual que la
  consola vino a sacar.

## What Changes

- La celda Role del roster gana **quitar el acceso**, ofrecida sobre toda cuenta
  `jhsc_member` activa. Es **un solo acto para los dos casos** —del lado del servidor
  cancelar una invitación y sacar a un miembro son la misma escritura, la cuenta queda
  inactiva—, y lo único que cambia según `can_sign_in` es cómo se llama el botón y qué dice
  la confirmación: cancelar deja sin uso un link que puede estar en un correo; quitar corta
  una sesión que puede estar abierta ahora mismo.
- **Quien perdió el acceso vuelve a ser, para el roster, una persona sin cuenta**: su fila
  no muestra ningún rol y ofrece `Invite to JHSC`, idéntica a la de quien nunca tuvo una.
  Que hubo acceso y cuándo terminó vive en la cadena de auditoría, no en una celda de una
  consola que muestra quién tiene acceso HOY.
- Y volver a darle acceso es, entonces, **invitarlo**: el mismo botón, el mismo diálogo y
  el mismo `POST /accounts`. Lo que cambia es del lado del servidor, donde `POST /accounts`
  pasa a **revivir** la cuenta dada de baja que esa persona ya tenía en vez de rechazar el
  alta. `app_user.person_id` es ÚNICO —no hay una segunda cuenta que crear, ni la habrá
  nunca—, pero eso es un hecho del motor y el cliente deja de conocerlo: hay un solo modo de
  decir "dale acceso a esta persona", y de qué lado del `if` cae lo decide el servidor. La
  cuenta vuelve con su `id`, su historia y su alcance; el correo es el que se tipee en el
  alta. Solo revive con el MISMO rol: revivir como `jhsc_member` la cuenta de un supervisor
  le cambiaría el rol sin que nadie lo pida, y eso sigue siendo el conflicto de siempre.
- **Dar de baja no revoca `user_site_scope`, y eso es una decisión, no un olvido.** El
  fanout de auditoría (`hs_account_audit_fanout`, 0005 §8) está diferido a COMMIT y escribe
  en la cadena de cada planta del alcance **vigente**: revocar el alcance en la misma
  transacción dejaría la baja sin ninguna entrada, que es el único rastro de cuándo terminó
  el acceso de alguien. El alcance intacto no da acceso —`hs_account_is_active` lo mata por
  `deactivated_at`— y de yapa hace que restituir sea un solo UPDATE.
- **Las sesiones se revocan después del COMMIT de la baja, en otra transacción.**
  `SessionService.revokeAllForUser` declara el alcance de la cuenta administrada, así que
  llamarla dentro de la transacción de la baja pisaría `app.site_ids` y `app.user_id`: el
  fanout diferido compararía contra el alcance del objetivo —perdiendo la comprobación
  HS002 que hace de permiso— y la entrada de auditoría diría que la persona removida se
  removió a sí misma. No abre ninguna ventana: el guard de sesión ya rechaza por
  `deactivated_at`, que quedó commiteado.
- Solo `jhsc_member`. Un supervisor, otro coordinador o un auditor externo se dan de baja
  por donde se dieron de alta: quitarle el acceso al coordinador de la planta de al lado no
  puede ser un clic en una lista de doscientas filas.
- Sin cambio de esquema. `updateAccountRequestSchema` gana `deactivated?: true` —un literal,
  no un booleano: por `PATCH` una cuenta solo se da de baja, y devolverle el acceso es
  invitar.

**Fuera de alcance**: cambiar el rol de una cuenta desde el roster, y el reinicio de
contraseña de una cuenta que sí puede entrar (sigue en `pnpm auth:reset-password`, como lo
dejó el change anterior).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: quitar el acceso al JHSC pasa a ser un requisito de la pantalla —el
  coordinador SHALL poder retirar desde el roster el acceso que desde el roster otorgó,
  tanto el de una invitación que nadie aceptó como el de un miembro que ya entra, en un
  solo acto confirmado—, y la fila de quien lo perdió SHALL leerse y comportarse como la de
  una persona sin cuenta. Invitar a alguien que ya tuvo cuenta SHALL devolverle la misma,
  porque una persona no admite una segunda. Se fija además que retirar el acceso
  **conserva** el alcance de sitio de la cuenta, para que el hecho quede escrito en la
  cadena de cada planta que alcanzaba, y que el acto no da de baja a la persona: perder el
  acceso no es irse de la empresa.

## Impact

- `packages/contracts/src/identity.ts` — `updateAccountRequestSchema` gana `deactivated?` y
  un `refine` que prohíbe combinarlo en `true` con `email` o `invite`.
- `apps/api/src/auth/account.service.ts` — `update()` gana la baja (`withdraw()`), y la
  guarda `can_sign_in` baja de la ruta a los dos actos que la necesitan (corregir correo,
  reemitir), porque quitarle el acceso a quien SÍ entra es el caso principal de la baja.
  `create()` gana `revive()`: `checkNoExistingAccount` se convierte en
  `findAccountOfPerson`, y una cuenta inactiva del mismo rol se revive en vez de rechazar
  el alta.
- `apps/api/src/auth/credential.service.ts` — la revocación de credenciales se extrae a
  `revokeCredentials(client, userId)`, mismo patrón que `revokePending`, para que entre en
  la transacción del llamador.
- `apps/api/src/auth/account.errors.ts` — `account_role_not_removable` (403) y
  `account_already_inactive` (409).
- `apps/web/src/api/roster.ts` — `removeJhscAccess`. `inviteAsJhscMember` no cambia: ya
  hace lo que el caso de volver a invitar necesita.
- `apps/web/src/routes/RosterRoute/` — `RemoveAccessDialog.tsx` nuevo; `presentation.ts`
  gana `canRemoveJhscAccess` con sus etiquetas y `showsAccountRole`, y `canInvite` pasa a
  admitir también a quien tiene una cuenta inactiva de `jhsc_member`. `InviteDialog.tsx` no
  se toca.
- Tests: `presentation.test.ts` (afordancias, y que la fila sin acceso se comporta igual
  haya tenido cuenta o no), `index.test.tsx` (confirmación, textos según el caso, la fila
  que queda y volver a invitar), `identity.test.ts` (los refines) y
  `apps/api/test/account-removal.int-spec.ts`, que es donde se fijan las dos propiedades
  que ningún test unitario ve: la entrada en la cadena de cada planta, y que la firma el
  coordinador.
- Sin migración: el motor ya concede `UPDATE (deactivated_at) ON app_user` y ya audita
  `user.deactivated` / `user.reactivated` (`0005_identity.sql`); lo que faltaba era la ruta.
