## Context

Ver `proposal.md — Why`. Lo que importa acá es qué existe ya:

- `POST /auth/invitations` (`auth.controller.ts`) → `InvitationService.issue()`: comprueba
  rol `hs_coordinator`, que la cuenta exista y no esté dada de baja, y que **no** tenga
  credencial activa (`CredentialService.hasActive`); después escribe con
  `writeInvitation()` dentro de `asAdministrator(...)`. Las tres guardas son exactamente
  las que el requisito nuevo pide, sin tocar ninguna.
- `GET /people` ya devuelve por fila `account.id`, `account.role`, `account.active` y
  `account.can_sign_in` (`roster.repository.ts`, `hs_account_is_active` + `EXISTS` sobre
  `app_credential`). El cliente no tiene que preguntar nada más para decidir si ofrecer la
  acción — pero **no** el correo: el roster lo omite a propósito (ver el requisito de
  lectura de `identity/spec.md`), así que el diálogo de reemisión necesita su propia
  lectura para mostrar qué correo va a corregir.
- La consola del roster ya monta el token FUERA de la fila que lo originó (D8 del change
  archivado), y `InvitationLink.tsx` ya resuelve mostrar-y-copiar una sola vez.
- El motor ya permite corregir el correo de una cuenta y ya lo audita, sin que este change
  tenga que pedir nada nuevo: `GRANT UPDATE (email, role, expires_at, records_from,
  records_to, deactivated_at) ON app_user TO hs_app` (`0005_identity.sql:846`), `email` no
  está entre las columnas congeladas de `hs_identity_guard()` para `app_user` (`id,
  person_id, created_at`), y `hs_account_changed_audit()` ya emite `user.email_changed`
  con el valor anterior y el nuevo cuando `NEW.email IS DISTINCT FROM OLD.email`. La spec
  general de `identity` ya lo pedía ("A correction to an email SHALL be possible and SHALL
  be a recorded event") sin que ninguna ruta lo hiciera todavía.

ADR-011 (el alta es por invitación del coordinador, sin autoservicio) y ADR-002 (nunca
DELETE: `revoked_at`) son los que mandan. **Tabla inmutable tocada:** `user_invitation`,
solo con el `UPDATE ... SET revoked_at` que la migración ya concede y que `revoke()` ya
usa. **Tabla mutable tocada:** `app_user.email`, con el `UPDATE` que la migración ya
concede — ningún permiso nuevo al rol `hs_app` en ninguna de las dos.

## Goals / Non-Goals

**Goals:**

- Que un link perdido tenga salida desde la pantalla, sin terminal.
- Que exista a lo sumo **un** token vivo por cuenta.
- Que el motivo más común de reemitir —un correo mal escrito— se resuelva en el mismo acto,
  sin una segunda pantalla ni una segunda confirmación.

**Non-Goals:**

- Reinicio de contraseña de una cuenta que ya entra (design D9 del change archivado).
- Cambiar quién puede emitir, cuánto dura el token, o cómo se acepta.
- Guardar, cachear o volver a mostrar un token ya emitido.
- Un `PATCH` de cuenta de propósito general: `role`, `deactivated` y el resto de
  `updateAccountSchema` no se exponen por esta ruta. Ver D5.

## Decisions

### D1 — La revocación de lo pendiente vive en `issue()`, no en `writeInvitation()`

`writeInvitation()` la comparte `AccountService.create()`, que la llama para una cuenta que
acaba de nacer en la misma transacción: ahí nunca hay una invitación previa, y un `UPDATE`
que siempre afecta cero filas es ruido que después alguien lee como si significara algo.
`issue()`, en cambio, es por definición el camino de la cuenta que ya existe.

El `UPDATE` va **dentro** de la `asAdministrator` que ya abre `issue()`, antes del `INSERT`:
mismo `COMMIT`, así que no existe el instante en que la cuenta se quedó sin ninguna
invitación válida ni el instante en que tuvo dos.

Alternativa descartada: que el cliente llame `POST /auth/invitations/revoke` y después
`POST /auth/invitations`. Son las dos llamadas que D4 del change archivado ya rechazó por la
misma razón: entre las dos cabe una pérdida de red, y lo que queda es una cuenta sin ningún
link y un coordinador que no sabe en qué mitad quedó.

### D2 — La acción se decide con `can_sign_in`, no con una consulta nueva

`can_sign_in: false` sobre una cuenta activa es exactamente "invitada y todavía no entró"
(D2 del change archivado, que ya lo usa para la etiqueta `(invited)`). Preguntarle al
servidor si hay una invitación pendiente sería una ruta nueva para decidir algo que la fila
ya sabe — y además la respuesta correcta no depende de que exista una pendiente: una
invitación **vencida** también deja `can_sign_in` en falso, y es justo el caso que hay que
poder reparar.

Consecuencia aceptada: se puede reemitir sobre una cuenta cuya invitación sigue viva. Es
deseable —el coordinador que perdió el link no sabe si venció— y el precio lo paga D1: la
anterior queda revocada.

### D3 — Un diálogo propio, no un flag sobre `InviteDialog`

Los dos flujos comparten el final (mostrar el token con `InvitationLink`) y nada más:
`InviteDialog` pide un email y crea una cuenta; este confirma y no crea nada. Atarlos con un
booleano deja un componente donde la mitad de los campos no aplica según el flag, que es la
forma conocida de que el flujo menos usado se rompa sin que ningún test lo note.
`InvitationLink.tsx` se reusa **sin tocar**: es la pieza que sí es la misma.

El diálogo confirma antes de emitir porque la acción invalida un link que puede estar en el
correo de alguien. No es una confirmación decorativa: es la única señal de que reemitir
rompe lo anterior.

### D4 — El token sigue viviendo fuera de la fila

Misma regla que D8 del change archivado, y por la misma razón: reemitir invalida
`queryKeys.roster(siteId)` y el refetch vuelve a dibujar la fila. El estado que abre el
diálogo (`reissuing`) vive en `RosterConsole`, no en la celda.

### D5 — Reemitir y corregir el correo son la MISMA ruta, y la guarda de `hasActive` se hereda

`PATCH /accounts/:id` con `{ email?, invite? }` reemplaza el uso que el roster hacía de
`POST /auth/invitations` (que sigue existiendo, para el bootstrap por terminal y los tests
que no pasan por HTTP). No son dos rutas —una para corregir, otra para reemitir— porque
separarlas reabre exactamente el problema de D1: entre las dos llamadas cabe una pérdida de
red, y lo que queda es un correo corregido sin invitación o una invitación con el correo
viejo.

La consecuencia que se busca, y no un efecto secundario: la guarda "rechazar si
`hasActive`" que ya protegía la reemisión pasa a proteger TAMBIÉN la corrección de correo,
sin escribirla dos veces. Cambiar el correo de una cuenta que ya puede entrar por esta vía
queda **imposible por construcción** — es la toma de control que un `PATCH` de propósito
general habilitaría, y es justo lo que D9 (fuera de alcance) reserva para el reinicio de
contraseña, un acto aparte con su propia confirmación.

Orden dentro de la única `asAdministrator`: cargar la cuenta → rechazar si `hasActive` →
si vino `email` y es distinto, `checkEmailAvailable` (excluyendo la propia cuenta) y
`UPDATE app_user SET email = …` → si `invite`, `revokePending` + `writeInvitation`. Es el
mismo orden con el que `AccountService.create()` ya compone alta + invitación (design D4
del change archivado): un solo `COMMIT`, ninguna llamada nueva que inventar.

`revokePending(client, userId)` se extrae de donde hoy vive inline en `issue()`
(`invitation.service.ts`), para que `issue()` y `AccountService.update()` compartan la
regla en vez de escribirla dos veces — la misma razón por la que D1 la puso ahí y no en
`writeInvitation()`.

### D6 — `GET /accounts/:id` es una lectura nueva, mínima, y no una puerta al roster de cuentas

El roster (`GET /people`) omite el correo a propósito (ver `identity/spec.md`, "The roster
does not disclose the account's email…"): colgar el correo de cada fila convertiría una
lectura de 200 personas en una lectura de 200 cuentas. `GET /accounts/:id` es la lectura
opuesta —una cuenta, no doscientas— y devuelve `accountDetailSchema`
(`personAccountSchema` + `email`), no `accountSchema` entero: sin alcance, sin ventanas de
auditor externo, sin nada que el diálogo no necesite mostrar. El aislamiento no se escribe
a mano: la consulta sale de `app_user` pero se une con `person`, cuya política de RLS ya
filtra — el mismo truco que `findRoster` documenta ("una cuenta sin una `person` visible no
aparece porque no hay fila de la que colgarla").

## Risks / Trade-offs

- **Reemitir por error deja sin efecto un link que la persona ya recibió** → La
  confirmación de D3 lo dice con esas palabras, y el remedio es apretar el botón otra vez:
  la acción es idempotente en su efecto útil (siempre queda exactamente un link vivo).
- **Un coordinador podría usarlo para "resetear" a alguien que ya entra** → No puede: la
  guarda `hasActive` de `issue()` lo rechaza, y es la misma que ya existía. El botón
  tampoco aparece en esa fila.
- **Dos coordinadores reemitiendo a la vez** → El `UPDATE` y el `INSERT` van en la misma
  transacción; el segundo en confirmar revoca la invitación del primero, así que el
  invariante "un solo token vivo" se sostiene y el link válido es el último emitido, que es
  la lectura correcta.
- **Un token más viajando por HTTP** → El mismo de siempre, con la misma regla de una sola
  vez: no entra a Dexie, no entra a la caché de TanStack Query y no hay ruta que lo repita.
- **Atar la corrección de correo a la reemisión le impide al coordinador corregir un
  correo sin también invalidar el link vigente** → Aceptado: `invite` queda con default
  `true` en la práctica de uso (el diálogo siempre lo pide), y el caso "solo quiero
  corregir el correo sin tocar el link" no existe todavía como necesidad — si aparece, es
  un `invite` opcional en el mismo request, no una ruta nueva.
- **Una lectura nueva (`GET /accounts/:id`) es superficie de más para exponer un correo**
  → Acotada por D6: un id a la vez, reducida a `accountDetailSchema`, solo
  `hs_coordinator`, y filtrada por la misma RLS de `person` que ya protege el roster.

## Migration Plan

Sin migración de esquema. `@hs/contracts` gana dos schemas (`accountDetailSchema`,
`updateAccountRequestSchema`); el rollback es revertir el despliegue — las invitaciones
revocadas y los correos corregidos quedan en estados que el sistema ya sabía leer antes de
este change (una invitación revocada, un `user.email_changed` en la cadena).
