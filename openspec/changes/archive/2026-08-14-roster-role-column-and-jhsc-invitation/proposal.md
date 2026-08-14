## Why

La consola del roster muestra quién trabaja en la planta, pero no quién **puede entrar al
sistema**: el rol vive en `app_user` y `GET /people` devuelve solo la `person`. El
coordinador mira doscientas filas sin poder distinguir a los tres que tienen cuenta, y para
dar de alta al cuarto tiene que salir de la aplicación, abrir una terminal en el servidor y
correr `pnpm auth:create-account` con el `employee_number` que acaba de leer en pantalla.

Emitir la invitación **ya es HTTP** (`POST /auth/invitations`, solo coordinador) y aceptarla
ya tiene pantalla (`/accept-invitation`). El único eslabón que sigue exigiendo una terminal
es el que está en el medio, y es justo el que la pantalla del roster tiene delante: esta
persona, sin cuenta, tiene que ser miembro del JHSC.

**Etapa de §7: ninguna.** La etapa 2 (Sitio, Persona, Usuario, auth, roster) está cerrada y
este change no la reabre: no agrega ninguna entidad ni ninguna regla de identidad. Existe
porque `2026-08-13-account-provisioning-command` dejó el alta detrás de un comando —correcto
para el desarrollador, inalcanzable para el coordinador— y porque la consola del roster, que
es donde la decisión se toma, no muestra el dato sobre el que se decide.

## What Changes

- **`GET /people` devuelve, junto a cada persona, la cuenta que la referencia** —su `role` y
  si ya puede iniciar sesión— o `null` cuando no tiene. La persona sigue siendo de solo
  lectura: lo que se agrega es la cuenta al lado, que es otra tabla y otra regla.
- **Nueva ruta `POST /accounts`**, solo `hs_coordinator`: crea el `app_user` y su
  `user_site_scope` en una sola transacción con el actor de auditoría declarado, que es lo
  que hoy hace `pnpm auth:create-account`. **La ruta no crea personas** —referencia una del
  roster— y **no crea credenciales**: la cuenta nace sin poder entrar y sigue necesitando la
  invitación.
- **La tabla del roster gana una columna Role y una acción por fila.** Sin cuenta, el botón
  invita como `jhsc_member`: crea la cuenta y emite la invitación en un solo gesto, y muestra
  el link de un solo uso para copiar (sin correo transaccional, ADR-011 / design D9). Con
  cuenta, la fila muestra el rol y no ofrece nada.
- **El rol de la invitación desde el roster es `jhsc_member` y solo ese.** Los otros cuatro
  siguen siendo del comando: un supervisor, un management o un auditor externo se dan de alta
  una vez cada varios meses y traen decisiones —alcance multi-planta, ventana de fechas— que
  no caben en un botón de una fila.
- `pnpm auth:create-account` **se queda**: es el único camino para los otros roles y para el
  alta inicial, cuando todavía no hay coordinador con sesión.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: el listado del roster gana la cuenta de cada persona en su respuesta (hoy
  especificado como seis columnas de `person` y nada más), y el alta de una cuenta —hoy
  especificada como estado alcanzable, sin decir por dónde se alcanza— gana una superficie
  HTTP con su regla de rol, su alcance y su auditoría.

## Impact

- **API**: `apps/api/src/roster/` (la lectura se amplía), y una superficie nueva de cuentas
  —controller, service y repositorio— junto a `apps/api/src/auth/`. `POST /auth/invitations`
  no se toca.
- **Contracts**: `packages/contracts/src/identity.ts` — la forma de la persona con su cuenta,
  y la de la petición de alta. `createAccountSchema` ya existe y es la que la ruta valida.
- **Web**: `apps/web/src/routes/RosterRoute/` (columna, acción y su estado de mutación),
  `apps/web/src/api/roster.ts`, `query-keys.ts` y los permisos de UI.
- **Sin migración.** No hay tabla nueva ni columna nueva: `app_user`, `user_site_scope` y
  `user_invitation` ya existen con sus `GRANT` y sus políticas RLS
  (`0005_identity.sql:859`). Lo que cambia es quién puede llegar a ellas, y por dónde.
- **Riesgo concentrado**: una ruta que escribe `app_user` es la primera vez que el alta de
  una identidad sale de una terminal. Si la transacción, el alcance declarado o el actor de
  auditoría quedan mal, el alta **funciona igual pero no escribe auditoría** — el mismo hueco
  silencioso que el comando vino a cerrar, ahora expuesto a la red.
