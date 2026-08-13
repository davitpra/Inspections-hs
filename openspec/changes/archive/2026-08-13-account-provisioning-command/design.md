## Context

Ver `proposal.md` — Why. Lo que hace falta acá son las tres restricciones del motor que
condicionan la forma del comando, y una del repo:

- **El alcance se declara antes del primer INSERT.** `person` lleva `FORCE ROW LEVEL
  SECURITY`, así que el `WITH CHECK` de la política alcanza también al rol que corre el
  comando. `set_config('app.site_ids', …, true)` y `set_config('app.user_id', …, true)` son
  `SET LOCAL`: mueren con la transacción.
- **El trigger de alta está diferido a `COMMIT`.** `hs_account_audit_fanout()`
  (migración `0005_identity.sql`) escribe una entrada en la cadena de **cada** planta del
  alcance de la cuenta, y está diferido justamente para encontrar el `user_site_scope` ya
  otorgado. Dos transacciones separadas producen un alta sin auditoría; una planta fuera de
  `app.site_ids` produce `HS002`.
- **Los `GRANT` ya alcanzan.** `0005_identity.sql:859` concede `SELECT, INSERT` sobre
  `person`, `app_user` y `user_site_scope` a `hs_app`. El comando corre como `hs_app` y no
  como `hs_migrator`, igual que `bootstrap-invitation.mjs` y por el mismo motivo: es una
  escritura de aplicación, y que el rol restringido alcance es parte de lo que prueba que
  la tabla está bien concedida.
- **`DbService` no se usa.** Es un provider de Nest y los comandos de este repo no levantan
  el contenedor: `bootstrap-invitation.mjs` y `demo-data.mjs` abren un `pg.Pool` directo.
  El comando declara su alcance a mano, que es exactamente la distinción que
  `withSiteScope*` marca frente a `withSession*` — acá no hay guard que produzca un
  `SessionScope`, y por eso no se puede fingir uno.

ADR-011 (invitación sin auto-registro, persona ≠ usuario) y ADR-002 (inmutabilidad forzada
por el motor) son los que aplican. **No toca ninguna tabla inmutable**: solo inserta en
`app_user` y `user_site_scope`, no actualiza ni borra nada, y no escribe en `audit_log` —
la escribe el trigger.

## Goals / Non-Goals

**Goals:**

- Que el alta sea un comando y no un procedimiento que hay que recordar.
- Que la transacción sea correcta por construcción: no que el operador se acuerde de abrir
  una, sino que no exista forma de correrlo sin ella.
- Que los cuatro fallos previsibles —persona inexistente, persona con cuenta, email tomado,
  planta fuera del alcance— den un mensaje que se entiende, antes de tocar nada.
- Que corra en producción, porque ahí es donde se da de alta a la gente.

**Non-Goals:**

- **`external_auditor`.** El `CHECK app_user_auditor_lifecycle` exige `expires_at` (≤ 90
  días), `records_from` y `records_to` juntos y coherentes; son tres flags más y toda su
  validación, para el rol que se crea una vez cada mucho. El comando lo rechaza por nombre
  con un mensaje que dice qué le falta y que va por SQL. Si el auditor externo se vuelve
  rutinario, es un change propio.
- **Emitir la invitación.** Sigue siendo `pnpm auth:bootstrap`.
- **Un endpoint HTTP.** Un alta por mes no justifica una pantalla, y la superficie de una
  ruta que crea cuentas es cara de asegurar. Si el coordinador termina necesitando darse de
  alta gente sin el desarrollador, eso es un change de consola de administración.
- **Crear la persona.** Si no está en el roster, entra por `pnpm roster:import`. Crear
  personas a mano por un atajo del alta es exactamente cómo el roster deja de ser el roster.

## Decisions

### 1. Corre en producción, y es el primer `auth:*` que lo hace

`auth:bootstrap` y `auth:reset-password` se niegan con `NODE_ENV=production`. Este no.

La regla real detrás de esas dos negativas no es "los comandos no corren en producción",
es **ningún comando establece ni reemplaza una credencial en producción**. `reset-password`
pone una contraseña conocida por quien corre el comando; `bootstrap` abre la puerta de la
primera cuenta sin que ningún coordinador lo haya pedido. Los dos convierten el acceso al
servidor en acceso a una cuenta, y por eso en producción la ausencia del comando **es** la
respuesta: ahí la credencial la revoca el coordinador desde la aplicación.

Este comando no toca `app_credential`. La cuenta que crea **no puede iniciar sesión**: nace
sin credencial y sigue necesitando una invitación emitida y aceptada. Lo peor que puede
hacer quien lo corre es crear una cuenta de más — visible, auditada en la cadena de cada
planta, y desactivable. Eso no es escalar privilegios, es exactamente lo que el rol `hs_app`
ya tiene concedido.

**Alternativa descartada**: negarse en producción por simetría con los otros dos. Habría
dejado el alta real —la única que importa— en el mismo `psql` que este change viene a sacar,
y la simetría habría sido cosmética: el motivo de las otras dos no aplica acá.

### 2. `--actor` obligatorio

El alta escribe una entrada en la cadena de auditoría de cada planta, y esa entrada nombra a
una persona. `app.user_id` no es un parámetro de conexión: es quién dio el alta.

Se pasa el email o el `userId` del coordinador en cuyo nombre se ejecuta. Sin default.

**Alternativa descartada**: resolver "el único `hs_coordinator` activo" cuando no hay
ambigüedad. Es más cómodo y funcionaría hoy —hay uno— pero deja el actor de un registro
inmutable decidido por omisión, y el día que haya dos coordinadores el comportamiento cambia
solo. Un registro que dice para siempre quién dio un alta no se llena por descarte.

**Alternativa descartada**: usar el coordinador semilla (`COORDINATOR_ID`). Atribuiría cada
alta del sistema a una cuenta de bootstrap, para siempre.

El comando valida que el actor exista, esté activo, y **tenga en su alcance todas las
plantas que va a otorgar** — antes de abrir la transacción. No es una comprobación
redundante con `HS002`: el trigger frena igual, pero lo hace en `COMMIT`, con un SQLSTATE
que no dice de quién ni de qué planta habla.

### 3. La persona se nombra por `employee_number`

Es lo que el coordinador tiene a mano, viene de ADP y es la identidad estable de la persona
en el roster. Un uuid hay que ir a buscarlo con un `SELECT`, que es la mitad del `psql` que
este comando viene a eliminar.

El comando resuelve `employee_number → person`, y falla si no existe diciendo que la
persona entra por `pnpm roster:import` — no la crea.

### 4. Una sola transacción, con el alcance DEL ACTOR, y no hay forma de correrlo sin ella

`BEGIN`, los dos `set_config(..., true)`, las comprobaciones que tocan `person`, el
`INSERT` de `app_user`, los `INSERT` de `user_site_scope`, `COMMIT`. Toda la corrección de
este comando está en que ese orden no sea opcional, y por eso el orden vive en el script y
no en el README.

**Corregido contra la base real.** La primera versión de este design decía que las
comprobaciones iban *antes* de abrir la transacción, y que `app.site_ids` llevaba
exactamente las plantas a otorgar. Las dos cosas estaban mal:

- `person` lleva `hs_apply_site_isolation` con `FORCE ROW LEVEL SECURITY`, que alcanza a
  `hs_app`. Sin alcance declarado la tabla se ve **vacía**, y el comando reportaba "no hay
  ninguna persona con ese employee_number" para todo el mundo. Las comprobaciones que
  tocan `person` tienen que correr con alcance, así que van dentro de la transacción — que
  además es más seguro, no menos: un fallo hace `ROLLBACK` y no deja nada atrás.
- El alcance que se declara es el **del actor**, no el de la cuenta que se crea. Es el
  criterio de `src/auth/account-scope.ts`, el único lugar del servidor donde se administra
  una cuenta, y la razón está escrita ahí: declarar el del actor convierte `HS002` en una
  regla de permisos gratis, sin un `if` que alguien pueda olvidarse de escribir. La
  comprobación explícita de la decisión 2 sigue estando, pero por el mensaje, no por la
  garantía.

### 5. Idempotente por consulta previa, no por `ON CONFLICT`

Antes de la transacción el comando comprueba, con mensajes distintos:

- la persona existe y está activa;
- **no** tiene ya una cuenta (`app_user_person_id_key` lo impediría, pero el mensaje del
  constraint no dice de quién es la cuenta que ya existe);
- el email no es de otra cuenta (`app_user_email_key`, mismo motivo);
- el rol es uno de los cuatro internos;
- las plantas existen por `code` (`st-thomas`, `glencoe`) y están en el alcance del actor.

Correrlo dos veces con los mismos datos **no crea una segunda cuenta**: informa que ya
existe, imprime su `userId` y sale con 0. Eso es lo que hace que sea seguro repetirlo, que
es lo que uno hace cuando no está seguro de si el primero funcionó.

`ON CONFLICT DO NOTHING` habría sido más corto y habría hecho que el segundo intento se vea
igual que el primero, que es la forma más rápida de creer que se creó algo que no se creó.

### 6. Dos pasos, con el siguiente impreso

El comando termina imprimiendo el `userId`, el email, el rol, el alcance otorgado, y la
línea que sigue lista para copiar:

```
pnpm auth:bootstrap <userId>
```

ADR-011 separa crear la cuenta de invitarla, y `invitation.service.ts` hace cumplir esa
separación en el servidor: invitar a alguien sin cuenta es un error, no un alta implícita.
Un `--invite` que encadenara los dos haría aparecer un token de invitación —el secreto que
existe una sola vez— en corridas donde nadie lo estaba esperando, y el token que nadie mira
es el token que queda en un scrollback.

## Risks / Trade-offs

- **Corre en producción y crea cuentas** → No crea credenciales: la cuenta nace sin poder
  iniciar sesión. Toda alta queda en la cadena de auditoría de cada planta con su actor. Es
  el mismo poder que el rol `hs_app` ya tiene concedido; el comando no lo amplía.
- **`--actor` obligatorio es fricción en cada corrida** → Es la fricción correcta: la
  alternativa es un registro inmutable que dice quién dio un alta y lo dice por descarte.
  Acepta email, que es lo que uno sabe de memoria.
- **El operador podría otorgar dos plantas a un `jhsc_member`** → El comando avisa —§6 dice
  que solo coordinación y gerencia llevan las dos— pero **no lo impide**: la spec es
  explícita en que el alcance es una propiedad de las filas otorgadas y no del rol
  (`identity/spec.md:301`), y un miembro del JHSC con las dos plantas es una decisión rara
  pero legítima. Convertir la advertencia en un error metería en un script una regla que la
  spec deliberadamente no puso en el motor.
- **Duplica reglas que el motor ya hace cumplir** (unicidad de email, de persona, rol del
  conjunto cerrado) → Duplica el *chequeo*, no la *garantía*: si el script se equivoca, el
  constraint frena igual. Lo que agrega es el mensaje, y el mensaje es todo el punto del
  comando.
- **Es un script `.mjs` sin tipos ni tests unitarios**, como el resto de la familia →
  Consistente con `bootstrap-invitation.mjs`, `demo-data.mjs` y `reset-password.mjs`. La
  verificación es correrlo contra la base real, incluida la comprobación de que la auditoría
  se escribió en cada planta — que es la única parte que un test de tipos no habría visto.

## Migration Plan

No hay migración: sin cambios de esquema, sin `GRANT` nuevos, sin despliegue de la API.

El comando se agrega y queda disponible. Nada existente cambia de comportamiento; el SQL a
mano del README sigue funcionando para quien lo tenga en un historial.

**Rollback**: borrar el script y sus dos entradas de `package.json`. Las cuentas creadas
mientras tanto son cuentas normales — el comando no las marca de ninguna forma.
