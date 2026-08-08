# Autenticación y sesiones

## Why

`identity-and-roster-import` dejó construida la identidad completa —persona, cuenta, rol,
alcance, ciclo de vida del auditor— y una propiedad declarada a propósito en su spec:
*"An account created here SHALL NOT be able to sign in until credentials are introduced
separately"*. Hoy el sistema sabe quién existe y qué alcanza, y no tiene forma de que esa
persona lo demuestre. `app.user_id` se declara a mano en un script; `audit_log.actor_user_id`
tiene FK a una cuenta real desde 0005, pero quién la elige es el operador del seed, no una
sesión. La cadena de auditoría es inmutable y todavía no prueba nada sobre *quién* actuó.

Este change agrega exactamente la pieza que falta —la credencial y la sesión— y con ella
**cierra la etapa 2 de §7** ("Sitio, Persona, Usuario, **auth**, importación CSV del roster"),
cuya propiedad a probar es *"permisos por sitio verificados con datos reales"*: no verificados
con un `set_config` escrito a mano en un test, sino derivados de un usuario que inició sesión.

Va ahora y no después porque la etapa 3 depende de él en un sentido fuerte. El outbox de una
inspección capturada sin señal sincroniza horas más tarde con un token que puede estar vencido;
ADR-011 convierte eso en un requisito propio —refresh silencioso al recuperar conexión, antes de
vaciar el outbox, y nunca descartar una entrada por un 401—, y ese contrato hay que tenerlo
escrito antes de que exista el outbox, no después de perder el primer recorrido de tres horas.

## What Changes

- **better-auth montado dentro de `apps/api`** (ADR-011), sobre la misma Postgres. Email y
  contraseña. Configurado contra `app_user` como su modelo de usuario: el email sigue viviendo
  **una sola vez**, y better-auth agrega solo lo suyo —credencial, sesión, segundo factor— en
  tablas propias. **La primera tarea es el spike de esa configuración**: si apuntar better-auth
  a `app_user` resultara imposible, el diseño cambia antes de escribir la migración, no después.
- **Alta solo por invitación del coordinador.** Sin auto-registro y sin ninguna vía por la que
  una cuenta llegue a tener credencial sin que un `hs_coordinator` la haya emitido. La
  invitación tiene vencimiento, se usa una sola vez y es el único momento en que se fija una
  contraseña sin conocer la anterior.
- **TOTP obligatorio para `hs_coordinator` y `management`, opcional para el resto.** Obligatorio
  significa que el motor —no un `if` del endpoint— impide que esas dos cuentas tengan sesión
  plena sin un segundo factor inscrito: mientras no lo inscriban, la sesión existe pero solo
  alcanza para inscribirlo.
- **La sesión transporta `user_id`, `person_id` y `site_scope[]`**, y es lo que alimenta
  `withSiteScope`. `app.site_ids` deja de ser un parámetro del llamador y pasa a derivarse del
  alcance efectivo de la cuenta autenticada; ningún endpoint puede ampliarlo.
- **Access token de vida corta con refresh.** Vida del access token en minutos; el refresh vive
  lo suficiente para cubrir la ventana de sincronización de 7 días de ADR-010. Rotación del
  refresh en cada uso y revocación en cadena si se reusa uno ya gastado.
- **El contrato offline de ADR-011, como requisito y no como nota**: refresh silencioso al
  recuperar conexión y antes de vaciar el outbox; un 401 sobre un envío diferido es un motivo
  para reintentar después de refrescar, nunca para descartar la entrada. El cliente que vacía el
  outbox llega en la etapa 3; el contrato de sesión y los códigos de error que lo hacen posible
  se fijan acá.
- **Cierre de sesión y revocación.** Desactivar una cuenta, revocarle un sitio del alcance o
  vencer un auditor invalida sus sesiones vivas, sin borrar ninguna fila.
- **El ciclo de vida del auditor externo, ahora con sesión** — riesgo I de §5. Las columnas y sus
  `CHECK` ya están en 0005; lo que falta y se agrega acá es que **sus lecturas queden registradas
  en el log de auditoría**, única excepción a la regla de no loguear lecturas, y que la ventana
  `records_from`/`records_to` deje de ser dos columnas validadas y pase a acotar lo que la sesión
  puede leer. El default de 30 días y el máximo de 90 se aplican en el alta por invitación.
- **Todo evento de autenticación entra en la cadena de auditoría**: alta de credencial, inicio y
  cierre de sesión, intento fallido, inscripción y reinicio de TOTP, revocación de sesión.

**Fuera de alcance, y es deliberado:** SSO / IdP externo (ADR-011 lo descarta para 15–20
usuarios sin SSO corporativo), auto-registro, y recuperación de contraseña por autoservicio —el
reinicio lo hace el coordinador, que es la misma vía por la que se crea la cuenta.

## Capabilities

### New Capabilities

Ninguna. La autenticación no es una capability nueva: es la mitad que le faltaba a `identity`, y
la capability para eso ya existe y ya es la dueña de `app_user`, del rol y del alcance. Inventar
`auth` partiría en dos la respuesta a "¿quién es esta persona y qué alcanza?".

### Modified Capabilities

- `identity`: agrega la credencial, la invitación, el segundo factor, la sesión y su refresh
  sobre las cuentas que ya modela. **Modifica** el requisito *"An account carries no credentials
  in this capability"*, que existía para declarar el estado intermedio y que este change es el
  encargado de levantar. Sustituye la afirmación *"no sign-in path exists for it"* por la
  contraria y la acota: la vía existe, empieza en una invitación del coordinador.
- `audit`: agrega los eventos de autenticación a la cadena, y la **única excepción del sistema a
  no loguear lecturas** —las del auditor externo—, que hasta ahora no tenía dónde escribirse
  porque no había sesión que supiera que quien lee es un auditor.

## Impact

- **`apps/api`** — deja de ser un esqueleto de NestJS. Módulo de autenticación con better-auth,
  guard de sesión, y el cableado de `withSiteScope` a la sesión en vez de a un parámetro.
  `apps/api/src/db/site-scope.ts` cambia de firma: `userId` deja de ser opcional para todo
  request autenticado.
- **Migración `0006`** — tablas de better-auth, invitación, y la tabla de lecturas del auditor.
  Con los `REVOKE`/`GRANT` y los triggers de ADR-002 como cualquier otra: una sesión se revoca,
  no se borra. **Toca una tabla inmutable**: `audit_log`, solo por `INSERT` de los nuevos tipos
  de evento; ninguna columna cambia y la cadena se verifica igual antes y después.
- **`packages/contracts`** — esquemas Zod de login, invitación, TOTP y refresh, y el tipo de la
  sesión que `apps/web` va a consumir. Es el primer contrato que cruza los dos lados.
- **`apps/web`** — cliente de sesión: almacenamiento del token, refresh al recuperar conexión, y
  el gancho que la etapa 3 va a llamar antes de vaciar el outbox.
- **Dependencias nuevas** — `better-auth` y su adaptador de Postgres/Drizzle en `apps/api`.
- **Seeds** — `004_bootstrap_coordinator.sql` sigue sin credencial y eso no cambia: la primera
  contraseña se fija por un comando de alta explícito, no por un seed que la deje conocida en
  todos los entornos.
- **Suite de integración** — los tests que hoy declaran `app.site_ids` a mano ganan una vía
  alternativa que arranca en un login real, que es lo que la etapa 2 tiene que dejar probado.
