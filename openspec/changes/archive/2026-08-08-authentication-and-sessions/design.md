## Context

Ver `proposal.md` — Why. Lo que ya está puesto y este change consume tal cual:

- **`app_user`, `user_site_scope` y `person`** de la migración `0005` (ADR-011, "Dónde vive la
  identidad"). El email vive ahí una sola vez, la tabla no tiene ninguna columna de secreto, el
  rol es un `CHECK` cerrado de cinco valores y el alcance son filas con `granted_at`/`revoked_at`.
- **`audit_log.actor_user_id`** con FK a `app_user` desde `0005` §12, nullable a propósito para
  seeds y eventos de motor.
- **`hs_account_audit_fanout()`** de `0005`: el patrón —ya escrito y probado— que escribe una
  entrada en la cadena de **cada sitio del alcance** de una cuenta, diferido a `COMMIT` para
  encontrar el alcance ya otorgado. Los eventos de autenticación de este change son exactamente
  el mismo problema y usan el mismo mecanismo.
- **`hs_forbid_mutation()`** y el patrón de mutabilidad parcial de `location`/`app_user`:
  `GRANT UPDATE (columnas)` frena a `hs_app` con `42501`, más un `BEFORE UPDATE` que frena a
  cualquier rol —`hs_migrator` incluido— con `HS001`. `HS002` es el código del fan-out cuando el
  sitio no está declarado en el alcance.
- **`withSiteScope`** (`apps/api/src/db/site-scope.ts`), que hoy recibe `siteIds` y un `userId`
  opcional como parámetros del llamador y los fija con `set_config(..., true)`.
- **Migraciones a mano** y registradas a mano en `_journal.json`; `drizzle-kit generate`
  prohibido (ADR-004).
- **`004_bootstrap_coordinator.sql`**, la única cuenta que existe, deliberadamente sin credencial.
- Suite de integración con Testcontainers sobre el mismo `db/init/01-roles.sql` del compose.

**Tablas inmutables que este change toca:** `audit_log`, y solo por `INSERT` de tipos de evento
nuevos. Ninguna columna cambia, `hs_audit_canonical` no se toca, y la verificación de la cadena da
lo mismo antes y después. Las tablas nuevas de este change son **parcialmente mutables** —una
sesión se revoca, un token se marca gastado— y por lo tanto **no** llevan `hs_make_immutable`:
llevan su propio `BEFORE UPDATE` restrictivo más la prohibición total de `DELETE`, como `app_user`.

Tres restricciones ordenan el diseño:

1. **La revocación tiene que ser inmediata.** Quitarle un sitio a una cuenta, desactivarla o
   vencer un auditor no puede esperar a que expire un token. Eso decide D3 y D4.
2. **No hay servidor de correo y no se agrega uno** (D9). Todo el ciclo de alta y de reinicio pasa
   por el coordinador, que es la vía que ADR-011 ya elige.
3. **`audit_log.site_id` es `NOT NULL`.** Un evento de autenticación no es de un sitio; una
   cuenta tampoco. `0005` ya resolvió ese problema con el fan-out y acá se reusa sin inventar nada.

## Goals / Non-Goals

**Goals:**

- Que `app.site_ids` deje de ser un argumento y pase a ser una consecuencia de quién inició
  sesión, sin que ningún endpoint pueda ampliarlo ni siquiera por error.
- Que un recorrido de tres horas sin señal termine con la inspección enviada, y que ningún camino
  de error de autenticación pueda perder una entrada del outbox.
- Que "esta lectura la hizo el auditor externo" sea una fila en la cadena escrita en la misma
  transacción que la lectura, y no algo que el endpoint recuerde hacer.
- Que el cambio de rol a `management` deje sin acceso pleno a una cuenta sin TOTP en el request
  siguiente, sin ninguna tarea programada.
- Que la etapa 3 encuentre el contrato de sesión ya escrito y solo tenga que llamarlo.

**Non-Goals:**

- Un modelo de permisos por recurso. Acá se decide *quién es* y *qué alcanza*; qué habilita cada
  rol lo deciden los changes que tengan endpoints de dominio. Las únicas reglas de rol de este
  change son las que la sesión misma necesita: quién invita, quién reinicia, y que el auditor no
  escribe.
- El outbox. Se fija el contrato que la etapa 3 tiene que respetar y el cliente de sesión que va a
  usar; la cola de inspecciones es de `offline-capture`.
- Endpoints de dominio. Este change deja `apps/api` con autenticación y con el cableado del
  alcance; no agrega una sola ruta de inspecciones ni de hallazgos.
- Aplicar la ventana de fechas del auditor a tablas que todavía no existen (D12).

## Decisions

### D1 — better-auth apuntado a `app_user`, y el spike es la tarea 1

ADR-011 lo pide y deja escrito el motivo: una tabla de usuarios propia de better-auth con su
propio `email` crearía dos verdades sobre la misma dirección. La configuración de modelos de
better-auth permite mapear la entidad de usuario a otra tabla y otros nombres de columna, y eso es
lo que se verifica **antes de escribir la migración `0006`**.

Lo que el spike tiene que dejar demostrado, contra la base real:

1. El modelo de usuario mapea a `app_user` sin exigir columnas nuevas obligatorias más allá de las
   que `0006` pueda agregar sin romper los `CHECK` de `0005`.
2. better-auth no intenta `DELETE` sobre `app_user` en ningún camino —ni al revocar, ni al limpiar
   sesiones expiradas—. Si lo hiciera, choca contra `hs_forbid_mutation()` y falla en runtime, no
   en el arranque.
3. Su limpieza de sesiones expiradas se puede desactivar o convertir en un `UPDATE revoked_at`.
   Una purga por `DELETE` es incompatible con el invariante del proyecto.

**Plan B, si (1) falla:** una tabla propia de better-auth con `app_user_id` como única columna de
identidad y **sin `email`**, y el email seguido leyéndose de `app_user` por join. Es peor —una
indirección más— pero conserva la propiedad que importa, que es que el email tenga un solo dueño.
La opción que **no** se toma en ningún caso es duplicar el email y sincronizarlo: la pregunta
"¿cuál gana?" no tiene respuesta buena y aparece justo cuando hay que revocarle el acceso a
alguien. Si el spike obliga al plan B, se actualiza este documento antes de seguir.

#### Resultado del spike (better-auth 1.6.26, contra la base de desarrollo)

**Cierra por el camino principal. El plan B no hace falta.** Tres hallazgos, y dos cambian este
documento:

1. **`app_user` no necesita ninguna columna nueva.** El modelo de usuario de better-auth declara
   `name`, `emailVerified`, `image` y `updatedAt` como requeridas, pero eso solo rige cuando es
   *él* quien inserta o actualiza al usuario — y acá nunca lo hace: las cuentas las crea el
   coordinador y el alta de credencial es la aceptación de una invitación, no un `signUp`. Con las
   cuatro columnas ausentes, `signInEmail` resuelve la cuenta por email contra `app_user`, emite
   token y crea la sesión; `user.name` vuelve `undefined` y nada se rompe. **Se verificó quitando
   las columnas y repitiendo el login**, y es el resultado que importa: el requisito aceptado de
   que el nombre viva solo en `person` sobrevive intacto.
2. **`signOut` emite `DELETE` sobre la tabla de sesión, y cuando el motor lo frena, better-auth
   responde `200 {"success":true}` igual.** El `DELETE` muere con `42501` —`hs_app` no tiene el
   privilegio, así que el trigger `HS001` ni llega a correr—, la librería lo registra como un
   error interno y **le contesta al cliente que cerró la sesión**. La fila queda viva y el token
   sigue sirviendo. Esto no es "incompatible con el invariante": es un cierre de sesión que no
   cierra nada, y es la razón de D15.
3. **El hook `databaseHooks.session.delete.before` intercepta el `DELETE` y se verificó que lo
   suprime** devolviendo `false`, dejando lugar a un `UPDATE`. Es la mitigación, y es obligatoria.

### D2 — Las tablas de better-auth llevan prefijo `app_`

`0005` ya eligió `app_user` sobre `user` por dos razones: `user` es palabra reservada en Postgres y
es el nombre por defecto de better-auth. La segunda razón se aplica igual a las otras: `session`,
`account` y `verification` son nombres genéricos en un esquema donde `account` ya significa otra
cosa —en este proyecto "cuenta" es `app_user`— y donde el resto de las tablas son nombres de
dominio.

Mapeo de modelos, todo por configuración:

| better-auth    | acá                | qué guarda                                     |
| -------------- | ------------------ | ---------------------------------------------- |
| `user`         | `app_user`         | ya existe, no se crea                          |
| `account`      | `app_credential`   | hash de contraseña y estado de bloqueo         |
| `session`      | `app_session`      | sesión viva, con `revoked_at`                  |
| `verification` | `app_verification` | material de un solo uso de los flujos internos |
| `twoFactor`    | `app_two_factor`   | secreto TOTP, con `confirmed_at` y `revoked_at`|

`app_refresh_token` y `user_invitation` son tablas del proyecto y no de better-auth. La primera la
explica D6; la segunda, que el ciclo de invitación de ADR-011 —emitida por el coordinador, con
vencimiento, de un solo uso, revocable— es una regla de negocio propia y no el flujo de
invitación de organizaciones que trae la librería.

`user_invitation` es tabla del proyecto, no de better-auth: el ciclo de invitación de ADR-011
—emitida por el coordinador, con vencimiento, de un solo uso, revocable— es una regla de negocio
propia y no el flujo de invitación de organizaciones que trae la librería.

**Alternativa descartada:** dejar los nombres por defecto. Ahorra unas líneas de configuración y
cuesta que `account` signifique dos cosas distintas en el mismo esquema para siempre.

### D3 — El access token es opaco y se resuelve contra `app_session`, no es un JWT autocontenido

Un JWT firmado con el rol y el alcance adentro se valida sin tocar la base, y esa es exactamente
la propiedad que no sirve acá: el alcance quedaría congelado hasta que el token expire. Revocarle
Glencoe a alguien, desactivarle la cuenta o vencerle el auditor tendría un retraso igual a la vida
del token, y la única forma de acortarlo sería acortar el token —lo que multiplica los refresh
sobre una red que ADR-010 asume mala.

Con 15–20 usuarios y dos sitios, el costo real de resolver el token contra `app_session` en cada
request es una consulta indexada por token en una base que ya está en el camino de cualquier
request útil. Se paga sin discutir.

**Consecuencia:** el token de acceso es un valor aleatorio, se guarda **hasheado** en
`app_session` —una base robada no da sesiones vivas— y la resolución es un lookup por el hash.

### D4 — El alcance se resuelve por request desde `user_site_scope`, no se congela en la sesión

Consecuencia directa de D3 y lo que hace verdaderos los escenarios de "un sitio revocado sale del
alcance en el request siguiente". El guard resuelve, en una sola consulta:

```
app_session (no revocada, no vencida)
  → app_user (no desactivado, expires_at no vencido)
  → person_id
  → user_site_scope activos → site_ids[]
```

y de ahí sale el objeto de sesión que ADR-011 pide: `user_id`, `person_id`, `site_scope[]`. Con
`role`, que el guard necesita para las tres reglas de rol de este change.

**`withSiteScope` cambia de firma.** Hoy recibe `{ siteIds, userId? }` de quien la llama; pasa a
recibir el objeto de sesión, y `userId` deja de ser opcional en el camino HTTP. Los scripts
—`seed.mjs`, `roster-import.mjs`— y los tests de integración siguen pudiendo declarar un alcance a
mano, porque no hay sesión detrás de una migración; eso se expresa como dos entradas distintas a
la misma función interna, y no como un parámetro opcional que un endpoint pueda pasar por error.

### D5 — Un token vencido y una sesión revocada se responden distinto, y ese es el requisito

Es el punto donde el requisito offline de ADR-011 se vuelve implementable. El cliente que vacía el
outbox tiene que poder distinguir dos cosas que hoy serían el mismo `401`:

| Condición                                            | Respuesta                        | Qué hace el cliente          |
| ---------------------------------------------------- | -------------------------------- | ---------------------------- |
| Access token vencido, refresh vivo                    | `401` + código `token_expired`   | Refresca y **reintenta**     |
| Sesión revocada, cuenta desactivada, refresh vencido  | `401` + código `session_ended`   | Pide login, **no descarta**  |
| Sesión válida, rol o alcance insuficiente             | `403`                            | Ni refresca ni reintenta     |

El código va en el cuerpo, tipado en `packages/contracts`, porque el status HTTP solo no alcanza y
un cliente que tenga que distinguirlos parseando un mensaje en inglés es un cliente frágil.

**Lo que nunca es una respuesta:** un `2xx` que descarta la entrada. El servidor no tiene forma de
saber si una entrada del outbox es descartable, y por eso no decide eso nunca.

### D6 — Refresh rotativo con detección de reuso, y una vida atada a ADR-010

- **Access token: 15 minutos.** Corto porque D3 lo hace barato de renovar.
- **Refresh token: 14 días.** ADR-010 fija la ventana de sincronización en 7 días; 14 es esa
  ventana más un margen igual, para que un dispositivo que vuelve el último día de la ventana
  todavía refresque en silencio. Menos de 7 días haría que el caso que el requisito existe para
  cubrir fallara justo en su borde.
- **Rotación en cada uso**, con el token presentado marcado gastado. **Reusar uno gastado revoca
  la cadena entera**, porque un refresh usado dos veces significa que existe una copia.

El riesgo conocido de la rotación es el falso positivo: el cliente refresca, se corta la red antes
de recibir la respuesta, y reintenta con el token que el servidor ya marcó gastado. Se mitiga con
una **ventana de gracia de 60 segundos**: un token gastado hace menos de 60 segundos devuelve el
mismo par que devolvió la primera vez, sin revocar nada. Pasada la ventana, se revoca la cadena.
Sin esa gracia, la red que ADR-010 describe convertiría la detección de robo en una expulsión
aleatoria en medio del campo.

**El refresh vive en su propia tabla, `app_refresh_token`, y no en columnas de `app_session`.**
Es una corrección posterior al spike y tiene dos motivos, en orden de peso:

1. **`app_session` la inserta better-auth**, con exactamente las columnas que conoce. Una columna
   `refresh_token_hash NOT NULL` en esa tabla haría fallar su `INSERT` con una violación de
   not-null en cada login, y darle un `DEFAULT` aleatorio produciría un token que el servidor
   guarda y nadie recibe. Toda columna que agreguemos a `app_session` tiene que ser anulable o
   traer default —`purpose` y `revoked_at` lo cumplen; un hash de refresh no puede.
2. **La rotación es de N a 1.** Una sesión emite muchos refresh a lo largo de su vida, y modelar
   la cadena como `parent_session_id` sobre `app_session` obligaría a crear una sesión nueva por
   cada refresh, que es justo lo que no queremos: la sesión es la unidad que se revoca. La cadena
   de rotación cuelga de `app_refresh_token.parent_id` y todas sus filas apuntan a una `session_id`
   que no cambia.

### D7 — El TOTP obligatorio se implementa como una sesión de alcance limitado, no como un rechazo

Si el login de un coordinador sin TOTP inscrito devolviera un error, no habría forma de que lo
inscriba: el alta por invitación no puede exigir que el coordinador inscriba el TOTP de otro,
porque el secreto es del titular. Y si devolviera una sesión plena, el requisito sería una
promesa.

Entonces devuelve una sesión con `app_session.purpose = 'enrol_two_factor'`. El guard la acepta en
exactamente dos rutas —emitir el secreto y confirmarlo con un código válido— y la rechaza en todas
las demás con `403`. Confirmar el TOTP no convierte esa sesión en plena: la revoca y obliga a un
login nuevo con código, que es el primer uso real del segundo factor y por lo tanto la prueba de
que quedó bien inscrito.

Lo mismo cubre el ascenso de rol: como el alcance de la sesión se decide en cada request contra el
`role` actual (D4), una cuenta que pasa a `management` sin TOTP deja de ser aceptada fuera de esas
dos rutas en el request siguiente, sin ninguna tarea programada que revise nada.

### D8 — El bloqueo por intentos fallidos vive en `app_credential`, no en memoria

`failed_attempts int` y `locked_until timestamptz`, con `GRANT UPDATE` acotado a esas dos columnas
más `revoked_at`. En memoria sería más rápido y se perdería en cada reinicio y en cada réplica;
con una sola instancia de API hoy y con la base ya en el camino del login, no hay nada que ganar.

Umbral 5, bloqueo 15 minutos. Un intento contra un email inexistente **no** crea ninguna fila:
crear una fila por email tecleado mal es una vía para llenar una tabla desde afuera. Se cuenta en
memoria y por IP, que es donde ese contador puede vivir sin persistirse.

### D9 — Sin correo transaccional: el token de invitación se lo entrega el coordinador

Agregar SMTP significa un proveedor, credenciales, plantillas, rebotes y una superficie de entrega
que hay que operar. Con 15–20 usuarios que están en la misma planta que el coordinador, y con un
alta que ADR-011 ya define como un acto explícito suyo, no se justifica.

El alta emite un token de un solo uso que la pantalla del coordinador muestra **una vez**; él lo
entrega por su canal. `expires_at` de la invitación: **72 horas**.

**Consecuencia declarada:** el token viaja fuera del sistema y su seguridad depende del canal que
elija el coordinador. Es aceptable porque es de un solo uso, dura 72 horas, es revocable, y la
primera acción del titular —fijar su contraseña— lo consume. Si alguna vez hace falta correo,
entra como change propio y no cambia nada de este diseño salvo cómo llega el token.

**Y por eso no hay recuperación por autoservicio.** Sin correo no hay a dónde mandar un link, y
ADR-011 ya la deja fuera de alcance. Reiniciar es revocar la credencial y emitir una invitación
nueva: el mismo camino, con el mismo registro en la cadena.

### D10 — Las lecturas del auditor se auditan en la capa que abre la transacción, no en cada endpoint

El requisito exige que un `SELECT` cometido sin su entrada sea un estado inalcanzable. Un
interceptor que escriba después de responder no lo garantiza, y pedirle a cada endpoint futuro que
se acuerde tampoco.

Se resuelve donde ya se resuelve el alcance: en `withSiteScope`. Cuando la sesión es de un
`external_auditor`, la misma transacción que fija `app.site_ids` escribe la entrada de lectura
antes de cometer, con los identificadores que la operación devolvió. Un endpoint nuevo hereda el
comportamiento por usar el helper, que es la única vía por la que se toca la base.

**La tensión que esto crea, declarada:** el auditor es de solo lectura, pero su transacción
escribe en `audit_log`. El motor no puede distinguirlo —`hs_app` tiene `INSERT` en `audit_log`
para todos—, así que "el auditor no escribe registros de dominio" lo aplica el guard, no la base.
Es la única regla de este change que no está forzada por el motor, y se declara acá en lugar de
dejarla implícita. Lo que sí fuerza el motor es lo de siempre: esa entrada no se puede editar ni
borrar después.

### D11 — Los eventos de autenticación reusan `hs_account_audit_fanout()` de `0005`

Ya existe, ya está probado contra dos sitios y ya resuelve el mismo problema: un hecho sobre una
cuenta no pertenece a un sitio, y `audit_log.site_id` es `NOT NULL`. Se agregan tipos de evento,
no un mecanismo.

Los eventos van por **trigger** cuando el hecho es una fila (`user_invitation` creada, aceptada o
revocada; `app_credential` creada o revocada; `app_two_factor` confirmado o revocado) y por
**escritura explícita dentro de la transacción del login** cuando el hecho no deja fila propia
(login exitoso, login fallido, bloqueo). La diferencia no es de estilo: un trigger sobre la fila
es imposible de olvidar, y los eventos sin fila no tienen dónde colgarlo.

### D12 — La ventana de fechas del auditor entra como mecanismo, y hoy solo tiene una tabla que acotar

`records_from`/`records_to` existen desde `0005` con su `CHECK`. Lo que falta es que acoten. La
forma coherente con ADR-004 es la misma que el aislamiento por sitio: dos settings de transacción
—`app.records_from`, `app.records_to`— que `withSiteScope` fija desde la sesión, y un helper
`hs_apply_record_window(regclass, column)` que agrega una política a la tabla que se le indique.

El problema honesto es que **las tablas que un auditor querría leer todavía no existen**:
inspecciones, hallazgos e incidentes son de las etapas 3 a 6. La única tabla con fecha de registro
que ya está es `audit_log`, y es justamente la que un auditor tiene sentido que lea.

Entonces: el helper se escribe y se prueba acá, aplicado a `audit_log.occurred_at`. Cada change
posterior que cree una tabla legible por el auditor la pasa por el mismo helper. Escribir el
mecanismo ahora y aplicarlo a una sola tabla es más barato que descubrir en la etapa 6 que la
ventana era un `WHERE` en siete endpoints.

### D13 — Ninguna tabla de sesión lleva RLS, por el mismo razonamiento de `0005`

`app_user` y `user_site_scope` quedaron sin política porque una política sobre el alcance que se
lee **para construir** el alcance es un arranque circular. Vale igual para `app_session` y
`app_credential`: el guard las lee antes de que exista alcance alguno.

**Consecuencia declarada, la misma que `0005`:** cualquier rol conectado puede leer la tabla de
sesiones. Lo que el motor sí niega es el `DELETE` sobre todas y el `UPDATE` sobre toda columna
fuera de los `GRANT`. Y los tokens están hasheados (D3), así que leer la tabla no da sesiones.

### D14 — El hash de contraseña es el que trae better-auth, y no se elige uno propio

better-auth trae scrypt con parámetros razonables. Sustituirlo por argon2id significa una
dependencia nativa más, una decisión de parámetros que hay que sostener, y salirse del camino que
la librería prueba en cada versión. Con este perfil de amenaza —15–20 cuentas internas, sin
registro público— la diferencia entre scrypt bien configurado y argon2id no es lo que decide nada;
lo que decide es que las contraseñas nunca salgan de `app_credential` y que el bloqueo por
intentos exista.

### D15 — Interceptar el `DELETE` de sesión de better-auth es obligatorio, porque el motor solo no alcanza

Es la consecuencia del hallazgo 2 del spike y la única decisión de este documento que no estaba
antes de correrlo.

El invariante de ADR-002 se sostiene siempre sobre la misma idea: **si el código se olvida, el
motor frena la sentencia y el error se ve**. Acá esa idea falla por primera vez, y no por culpa
del motor: el motor frena el `DELETE` correctamente, pero better-auth trata ese error como interno,
lo registra y le responde `200 {"success":true}` al cliente. El resultado es el peor de los tres
posibles —peor que borrar la fila y peor que fallar—: el usuario cree que cerró sesión, la fila
sigue viva y su token sigue autenticando.

Entonces `databaseHooks.session.delete.before` **no es una optimización ni una preferencia de
estilo, es la barrera**: intercepta el `DELETE`, escribe `revoked_at`, y devuelve `false` para que
la librería no llegue nunca a emitir la sentencia. Se aplica a todos los caminos de la librería
que borran sesiones —`signOut`, `revokeSession`, `revokeSessions`, `revokeOtherSessions` y la
limpieza de expiradas—, porque todos pasan por el mismo hook.

Y como la barrera vive en TypeScript y no en SQL, **la prueba tiene que vivir en la suite de
integración**: un test que cierra sesión de verdad y verifica dos cosas que el `200` no distingue
—que la fila quedó con `revoked_at`, y que el token ya no autentica—. El `GRANT` sin `DELETE` y el
trigger `hs_forbid_mutation()` se dejan igual: son la red de abajo, y su valor es que si alguien
quita el hook, el `DELETE` sigue sin ocurrir. Lo que ninguno de los dos puede dar es el error
visible.

### D16 — Las rutas HTTP de better-auth no se montan. La única superficie es nuestro controlador

Segunda corrección posterior al spike, y es de seguridad.

`auth.handler` expone el router completo de la librería: `/sign-in/email`, `/sign-out`,
`/list-sessions`, `/revoke-session` y compañía. Cada una de esas rutas **desconoce todas las
reglas de este change**: no mira el bloqueo por intentos fallidos, no exige el segundo factor de
un `hs_coordinator`, no distingue una cuenta desactivada de una vencida, no fija `purpose`, no
escribe el evento en la cadena de auditoría y no emite refresh. Montarlas al lado de las nuestras
no sería redundancia: sería dejar abierta una puerta que da al mismo cuarto sin ninguna de las
cerraduras.

Entonces de better-auth se usa el **contexto**, no el router: `auth.$context.password.hash` y
`.verify` para la credencial, y el mapeo de modelos para que la librería sepa leer las tablas. La
fila de sesión la insertamos nosotros, con su `purpose` ya puesto —que además es lo único que
permite que `purpose` sea una columna congelada por el guard en lugar de una que se actualiza
después—, y el refresh es enteramente nuestro.

**Lo que esto significa sobre la elección de ADR-011, dicho sin adornos:** de la librería queda el
hash de contraseña y el modelo de credencial. Es poco, y es exactamente lo que ADR-011 pedía al
elegirla por "menor superficie" para 15–20 usuarios sin SSO. Lo que no se sostiene es la idea de
que iba a traer el flujo entero: las reglas que este sistema necesita —invitación del coordinador,
TOTP obligatorio por rol, bloqueo, alcance por sitio, auditoría encadenada, refresh que sobrevive
una semana sin señal— no son configurables en ninguna librería de autenticación, porque no son de
autenticación: son de este dominio.

El hook de D15 se mantiene puesto igual, aunque con el router desmontado casi ningún camino de
borrado de la librería llegue a correr. Cuesta cinco líneas y cubre el día que alguien use una API
suya sin darse cuenta de que por dentro borra.

## Risks / Trade-offs

- ~~**better-auth no se deja apuntar a `app_user`**~~ → **Cerrado por el spike**: mapea sin agregar
  una sola columna a `app_user`. Ver el resultado en D1.
- **better-auth reporta éxito cuando el motor le frena una escritura** (hallazgo 2 del spike) → El
  riesgo real no es el `DELETE` de sesión, que D15 intercepta, sino que el patrón se repita en
  algún camino futuro de la librería que todavía no recorremos. Se mitiga con la regla que D15
  deja establecida: de la autenticación no se prueba la respuesta, se prueba el estado de la fila
  y si el token sigue sirviendo. Y con la versión fijada exacta, para que un salto menor no
  agregue un camino de escritura sin que nadie lo mire.
- **Un lookup a la base por request autenticado** (D3) → Con 15–20 usuarios es ruido. Si algún día
  dejara de serlo, el arreglo es cachear la resolución de sesión unos segundos, no volver al JWT
  autocontenido: el requisito de revocación inmediata es del negocio y no del transporte.
- **La rotación de refresh expulsa a un cliente con red intermitente** → Ventana de gracia de 60
  segundos (D6). El costo es que un token robado y usado dentro de ese minuto no se detecta; es un
  intercambio consciente y el lado que se elige es el del inspector en el campo.
- **El token de invitación viaja por un canal que el sistema no controla** (D9) → De un solo uso,
  72 horas, revocable, y cada emisión y cada aceptación quedan en la cadena. Un token filtrado y
  usado es visible en el log de auditoría de los dos sitios de la cuenta.
- **"El auditor no escribe" lo aplica el guard, no el motor** (D10) → Es la única regla del change
  que se sale del invariante de ADR-002, y por eso se declara en vez de dejarla implícita. La
  mitigación es que la superficie de escritura de un auditor sea cero rutas: la prueba de
  integración recorre las rutas y verifica que ninguna acepta una sesión de ese rol.
- **La ventana de fechas se prueba contra una sola tabla** (D12) → Cada change posterior tiene que
  acordarse de aplicar el helper. Se mitiga como se mitigó `hs_apply_site_isolation`: el helper
  existe, tiene un consumidor real, y su omisión en una tabla nueva es visible en el review de la
  migración.
- **Sesión de alcance limitado para el TOTP pendiente** (D7) → Es una sesión más que el guard tiene
  que tratar distinto, y un guard con dos modos es un guard donde se puede colar un bug. Se mitiga
  con la forma: el modo restringido es la lista blanca de dos rutas, no una lista negra.

## Migration Plan

1. **Spike de D1** contra la base real, antes de escribir SQL. Si falla, se actualiza este
   documento y recién después se sigue.
2. **`0006_authentication.sql`**, escrita a mano y registrada a mano en `_journal.json`
   (ADR-004). Tablas nuevas con sus `CHECK`, sus `BEFORE UPDATE` restrictivos, `hs_forbid_mutation`
   para `DELETE`/`TRUNCATE`, `GRANT` acotados por columna, triggers de fan-out de auditoría, y
   `hs_apply_record_window` aplicado a `audit_log`.
3. **Alta de la primera credencial**: un comando de servidor —no un seed— que emite una invitación
   para el coordinador del bootstrap e imprime el token una vez. Es la única vez que se emite una
   invitación sin sesión de coordinador detrás, y el comando lo dice en su salida.
4. **Rollback**: `0006` solo agrega. La vuelta atrás es dejar de montar el módulo de
   autenticación; el esquema anterior sigue siendo válido y ninguna tabla existente cambia de
   forma. Lo único no reversible es el `INSERT` de eventos nuevos en `audit_log`, que es
   append-only por diseño y no estorba: un tipo de evento que ya no se escribe no invalida la
   cadena.
