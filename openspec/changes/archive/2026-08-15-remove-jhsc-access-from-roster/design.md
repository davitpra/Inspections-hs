## Context

Ver `proposal.md — Why`. Lo que existe ya, y que este change no vuelve a construir:

- `PATCH /accounts/:id` → `AccountService.update()` corre entero dentro de una sola
  `asAdministrator(...)`, que declara el alcance **del actor** y convierte HS002 en la
  comprobación de permisos (ver `account-scope.ts`). Ya carga la cuenta con
  `findAccountDetail`, ya corrige el correo y ya emite con `revokePending` +
  `writeInvitation` en un solo COMMIT.
- `GET /people` ya devuelve por fila `account.id`, `account.role`, `account.active` y
  `account.can_sign_in`. Con eso alcanza para decidir las cuatro afordancias sin ninguna
  consulta nueva — la misma economía que D2 del change de reemisión.
- El motor ya concede y ya audita todo lo que la baja necesita: `GRANT UPDATE (…,
  deactivated_at) ON app_user` (`0005_identity.sql:846`), `GRANT UPDATE (accepted_at,
  revoked_at) ON user_invitation` (`0006:501`), `GRANT UPDATE (…, revoked_at) ON
  app_credential`, y `hs_account_changed_audit()` emite `user.deactivated` /
  `user.reactivated` (`0005:691-695`). **Ningún permiso nuevo, ninguna migración.**
- El guard de sesión ya rechaza una cuenta con `deactivated_at` en cada request
  (`session.service.ts:150`), y el spec ya exige que dar de baja termine las sesiones
  ("A session ends when the account loses the right to hold it").

ADR-002 manda: nunca DELETE, todo es `deactivated_at` / `revoked_at`.

## Goals / Non-Goals

**Goals:**

- Que una invitación mal dirigida se pueda cancelar desde la pantalla.
- Que salir del JHSC no requiera `psql`.
- Que una baja por error tenga vuelta atrás, y que volver atrás sea simplemente invitar de
  nuevo: la fila de quien perdió el acceso no debe delatar que hubo una cuenta.
- Que la baja quede escrita en el registro regulatorio de cada planta que la cuenta
  alcanzaba, firmada por quien la ejecutó.

**Non-Goals:**

- Cambiar el rol de una cuenta desde el roster.
- Dar de baja a la persona: perder el acceso no es irse de la empresa. El roster lo
  mantiene el CSV de ADP.
- Administrar desde el roster cuentas que no son `jhsc_member`.
- Reinicio de contraseña de una cuenta que ya entra (sigue fuera, como en el change
  anterior).

## Decisions

### D1 — Cancelar una invitación y quitar a un miembro son EL MISMO acto

Del lado del servidor, "esta cuenta ya no da acceso" es un solo hecho: se revoca la
invitación pendiente, se revoca la credencial y se pone `deactivated_at`. Que la persona
haya llegado o no a poner su contraseña no cambia ninguna de las tres escrituras — solo
cambia cuál de ellas encuentra algo que hacer.

Partirlo en dos endpoints según `can_sign_in` dejaría dos caminos que hay que mantener
iguales para siempre, y el día que uno gane una guarda el otro no la tiene. La diferencia
que el coordinador sí percibe —cancelar un link vs. cortarle la sesión a alguien— es de
**redacción**, y vive en `removeButtonLabel` y en el texto del diálogo.

Alternativa descartada: exponer `POST /auth/invitations/revoke` en la pantalla para el caso
de la invitación pendiente. Deja la cuenta viva sin link, que es un tercer estado que nadie
pidió —"invitada pero sin invitación"—, y encima pide el `invitation_id`, que el roster no
devuelve y que habría que agregar a `personAccountSchema` solo para esto.

### D2 — La baja NO revoca `user_site_scope`

La que parece la limpieza obvia es la que rompe la auditoría.

`hs_account_audit_fanout()` (0005 §8) escribe la entrada en la cadena de **cada planta del
alcance vigente** de la cuenta, y el trigger está **diferido a COMMIT**. Si la misma
transacción que pone `deactivated_at` revoca las filas de `user_site_scope`, al llegar el
COMMIT la cuenta no alcanza ninguna planta y el fanout no escribe **nada**: la baja quedaría
sin rastro, y el único rastro es justamente lo que un inspector del MLITSD va a buscar
cuando pregunte cuándo terminó el acceso de alguien. El propio SQL declara esa consecuencia
en un comentario.

Y no hace falta: `hs_account_is_active` mata la cuenta por `deactivated_at`, el guard de
sesión la rechaza en el request siguiente, y el alcance de una cuenta inactiva no se usa
para nada. De yapa, revivir la cuenta (D4) casi no tiene que re-otorgar filas de alcance:
las que había siguen vivas.

Está fijado por un test de integración que falla si alguien "ordena" esto más adelante.

### D3 — Las sesiones se revocan DESPUÉS del COMMIT, en otra transacción

`SessionService.revokeAllForUser(userId, reason, client?)` acepta un cliente, y la tentación
es pasárselo para que todo sea un COMMIT. No se puede: empieza llamando a
`declareScopeFor(client, userId)`, que pisa `app.site_ids` **y `app.user_id`** con los de la
cuenta administrada. Dentro de la `asAdministrator` de la baja eso tendría dos efectos, los
dos silenciosos:

- el fanout diferido al COMMIT compararía contra el alcance del **objetivo** en vez del
  actor, y ahí muere la comprobación HS002 que es la única que impide que un coordinador
  administre a alguien de una planta que no tiene;
- `app.user_id` quedaría en el objetivo, así que la entrada diría que la persona removida se
  removió a sí misma.

Entonces la baja hace COMMIT y recién después se llama `revokeAllForUser` sin cliente, para
que abra la suya y declare el alcance del objetivo — que es lo correcto para el fanout de
`session.revoked`. No hay ventana de acceso: `deactivated_at` ya está commiteado y el guard
lo lee en el request siguiente. Las dos mitades están fijadas por el test de integración.

### D4 — Volver a invitar revive la cuenta, y el cliente no se entera

`app_user.person_id` es UNIQUE. Una persona no puede tener una segunda cuenta, ni siquiera
después de que la primera se dio de baja: el índice único lo impide. Ese es el hecho del
motor. La pregunta de diseño es **quién tiene que conocerlo**.

La primera versión de este change lo puso en la pantalla: la fila de una cuenta dada de baja
mostraba `JHSC member (removed)` y ofrecía `Restore access`. Las dos cosas son la
restricción del motor filtrándose a la UI. El coordinador no piensa en filas de `app_user`
—para él, quitar del JHSC devuelve a esa persona a ser una persona más del roster, y volver
a darle acceso es invitarla, igual que la primera vez—, así que la pantalla le estaba
contando un detalle de implementación y pidiéndole que lo tuviera en cuenta.

Entonces la conclusión se invierte:

- **La fila de una cuenta inactiva se dibuja como la de quien no tiene cuenta.** Sin rol y
  con el botón de invitar. `showsAccountRole` es la función que lo dice, y `canInvite` gana
  el segundo caso.
- **`POST /accounts` revive.** Si la persona tiene una cuenta dada de baja del mismo rol, el
  alta la reactiva —`deactivated_at` a null, el correo del alta, el alcance que falte— en
  lugar de rechazar con `account_already_exists`. Vuelve la MISMA fila, con su `id`, su
  historia de auditoría y su alcance; el motor escribe `user.reactivated` y, si el correo
  cambió, `user.email_changed`.

Hay **un solo** modo de decir "dale acceso a esta persona", y de qué lado del `if` cae lo
decide el servidor. La alternativa —dejar el `PATCH` de restitución y solo cambiarle la
etiqueta al botón— le deja al cliente un `if` que dice "si esta persona tiene una cuenta
inactiva, invitar significa otra cosa": dos caminos para una sola intención, que es el mismo
olor que D1 evitó al unificar cancelar-y-quitar.

Consecuencia: **`PATCH /accounts/:id` se queda solo con la baja**, y el contrato lo dice en
el tipo con `deactivated: z.literal(true)`.

**Solo revive con el mismo rol.** Revivir como `jhsc_member` la cuenta dada de baja de un
supervisor le cambiaría el rol sin que nadie lo pida, y eso es una decisión con su propio
evento de auditoría. Si el rol no coincide, sigue siendo `account_already_exists`. La
pantalla nunca produce ese caso —`canInvite` comprueba el rol—, así que la guarda protege a
quien llame la API a mano.

### D5 — La guarda `can_sign_in` baja de la ruta a los dos actos que la necesitan

Antes, `update()` empezaba con `if (existing.can_sign_in) throw accountAlreadyActive()`, y
estaba bien: era la ruta de la reemisión, y reemitirle el link a quien ya entra es la toma
de control que el reinicio de contraseña se reserva.

Pero quitarle el acceso a quien SÍ puede entrar es justamente el caso principal de este
change — sacar del comité a un miembro que trabaja todos los días. Así que la guarda pasa a
cubrir `email` e `invite`, que son los dos actos cuyo riesgo describe, y la baja no la
tiene. Un test de integración fija que bajó y no desapareció.

### D6 — El contrato prohíbe `deactivated: true` junto con `email` o `invite`

Emitir un link para una cuenta que se está dando de baja es un pedido que se contradice.
Aceptarlo obligaría al servicio a elegir cuál de los dos gana, y esa elección sería una
regla no escrita. El `refine` lo rechaza en `updateAccountRequestSchema`, donde el cliente
lo ve.

Y el campo es `z.literal(true)`, no un booleano: por esta ruta una cuenta **solo se da de
baja**. Un `deactivated: false` sería el segundo camino a devolver el acceso que D4
descarta, y prohibirlo en el tipo es más barato que descubrirlo en una revisión.

### D7 — Dar de baja dos veces se rechaza

`account_already_inactive` (409) y no una baja idempotente. Dos coordinadores apretando a la
vez escribirían dos `deactivated_at` distintos y dos entradas del mismo hecho, y la segunda
pisaría la fecha en la que el acceso realmente terminó — que es el dato por el que existe la
entrada.

### D8 — Un diálogo nuevo, no un flag sobre los existentes

Misma decisión que D3 del change de reemisión, por la misma razón: `RemoveAccessDialog` no
devuelve token y solo confirma, así que atarlo a `ReissueDialog` con un booleano dejaría un
componente donde la mitad de los campos no aplica según el caso.

Lo que sí comparte un solo componente son los dos casos de la baja (D1): ahí la diferencia
es de texto, y `canSignIn` la resuelve. Ese `canSignIn` viaja en el estado del modal y no se
vuelve a leer de la fila — la mutación invalida el roster, y una confirmación que cambia de
texto debajo del cursor es peor que una que se queda con el que abrió.

Volver a invitar **no estrena ningún diálogo**: es `InviteDialog` sin tocar (D4). El correo
se pide de cero, como en cualquier invitación, y ese campo vacío es parte de lo que hace que
las dos filas se vivan igual.

## Risks / Trade-offs

- **Una cuenta inactiva conserva su alcance de sitio.** Leído sin contexto parece un permiso
  colgado. No lo es —`hs_account_is_active` y el guard de sesión lo neutralizan— pero es
  contraintuitivo, y por eso está escrito en el spec, en el código y en un test: el que
  venga a "limpiarlo" tiene que chocar con los tres.
- **La revocación de sesiones puede fallar después de que la baja commiteó.** El acceso ya
  está cortado (el guard lee `deactivated_at`), así que lo que quedaría es una fila de
  `app_session` sin `revoked_at` que el spec pide. Es el precio de D3, y es el barato: la
  alternativa es perder la comprobación de permisos y firmar mal la auditoría.
- **Solo `jhsc_member`.** El coordinador que quiera quitarle el acceso a un supervisor
  sigue necesitando la terminal. Es deliberado (ver `proposal.md`), y si aparece la
  necesidad real es un change propio con su propia confirmación.
