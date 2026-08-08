## 1. Spike de better-auth contra `app_user` (bloquea todo lo demás)

- [x] 1.1 Agregar `better-auth` y su adaptador de Drizzle/Postgres a `apps/api`. Fijar versión
      exacta, sin rango: la configuración de mapeo de modelos es lo que este change apuesta y un
      salto menor que la cambie tiene que ser una decisión, no un `pnpm update`.
- [x] 1.2 Escribir la configuración de mapeo de modelos de design D2 (`app_user`,
      `app_credential`, `app_session`, `app_verification`, `app_two_factor`) contra la base de
      desarrollo, y verificar que arranca sin exigir ninguna columna que `0005` no pueda dar.
      **Cierra: `app_user` no necesita ninguna columna nueva** — ver el resultado del spike en
      design D1.
- [x] 1.3 Verificar el punto 2 del spike (design D1): que ningún camino de better-auth emita
      `DELETE` sobre `app_user`, `app_session` o `app_credential` — revocación, cierre de sesión y
      limpieza de expiradas incluidos. **Sí emite `DELETE` sobre la sesión, y cuando el motor lo
      frena responde `200 {"success":true}` igual**: el test de integración por lo tanto no
      verifica el error —no hay— sino el estado de la fila y que el token deje de servir (design
      D15). Se escribe en 9.7.
- [x] 1.4 Verificar el punto 3: desactivar la purga de sesiones expiradas o reemplazarla por un
      `UPDATE revoked_at`. **Elegido: `databaseHooks.session.delete.before` que escribe
      `revoked_at` y devuelve `false`**, verificado en el spike; cubre los cinco caminos de borrado
      de la librería a la vez. Queda escrito en el módulo con el razonamiento de design D15.
- [x] 1.5 **Puerta de decisión.** Si 1.2 no cierra, implementar el plan B de design D1 (tabla
      propia sin `email`, join contra `app_user`) y **actualizar `design.md` antes de seguir**. Si
      el plan B tampoco cierra, parar y reevaluar la librería: no escribir `0006`.
      **Camino principal, sin plan B.** `design.md` actualizado con el resultado, con D15 (nueva) y
      con el refresh movido a su propia tabla en D6.

## 2. Migración `0006` — credencial, invitación y segundo factor

- [x] 2.1 Crear `apps/api/drizzle/0006_authentication.sql` con el encabezado del proyecto: qué
      etapa de §7 cierra (la 2), qué ADR implementa (011), los SQLSTATE que usa (`HS001`, `HS002`,
      `42501`) y la advertencia de que está escrita a mano porque `drizzle-kit generate` está
      prohibido (ADR-004).
- [x] 2.2 Crear `app_credential` con las columnas del modelo `account` de better-auth —`id text` PK
      porque los ids de sus filas los genera él, `account_id`, `provider_id`, y el hash en la
      columna que él nombra, `password`, no `password_hash`— más
      `user_id uuid NOT NULL REFERENCES app_user (id)`, `failed_attempts int NOT NULL DEFAULT 0`,
      `locked_until timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`,
      `revoked_at timestamptz`, más el único **parcial**
      `UNIQUE (user_id) WHERE revoked_at IS NULL` — una cuenta tiene como mucho una credencial
      activa, y las revocadas se conservan (design D8, spec "A credential belongs to exactly one
      account").
- [x] 2.3 Crear `user_invitation`: `id uuid` PK, `user_id uuid NOT NULL REFERENCES app_user (id)`,
      `issued_by_user_id uuid NOT NULL REFERENCES app_user (id)`, `token_hash text NOT NULL`,
      `issued_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`,
      `accepted_at timestamptz`, `revoked_at timestamptz`. Comentar que el token se guarda
      hasheado por el mismo motivo que el de sesión (design D3) y que las 72 horas de design D9
      las fija el contrato Zod, no un `CHECK`, porque el motor no distingue "no lo pusiste" de
      "pusiste 72".
- [x] 2.4 Único parcial `UNIQUE (user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL`: una
      cuenta no puede tener dos invitaciones vivas a la vez.
- [x] 2.5 Crear `app_two_factor`: `id uuid` PK,
      `user_id uuid NOT NULL REFERENCES app_user (id)`, `secret text NOT NULL`,
      `created_at timestamptz NOT NULL DEFAULT now()`, `confirmed_at timestamptz`,
      `revoked_at timestamptz`, más `UNIQUE (user_id) WHERE revoked_at IS NULL`. Comentar que un
      reinicio del coordinador es `revoked_at` y una fila nueva, nunca un `UPDATE secret`.
- [x] 2.6 Triggers `BEFORE UPDATE` de las tres tablas, rechazando con `HS001` todo cambio de `id`,
      `user_id`, `created_at`/`issued_at`, `password_hash`, `secret`, `token_hash` y
      `issued_by_user_id`. Lo mutable de cada una es exactamente: `failed_attempts`,
      `locked_until` y `revoked_at` en `app_credential` —más `updated_at`, que better-auth
      reescribe en cada `UPDATE` suyo—; `accepted_at` y `revoked_at` en `user_invitation`;
      `confirmed_at` y `revoked_at` en `app_two_factor`.
- [x] 2.7 Triggers `BEFORE DELETE`/`BEFORE TRUNCATE` con `hs_forbid_mutation()` sobre las tres —
      la barrera que también alcanza a `hs_migrator`, y la que el test de 1.3 usa para probar que
      better-auth no borra.
- [x] 2.8 `GRANT SELECT, INSERT` sobre las tres a `hs_app`, más `GRANT UPDATE` acotado por columna
      a exactamente las columnas de 2.6. Sin `DELETE`, nunca.

## 3. Migración `0006` — sesión y refresh

- [x] 3.1 Crear `app_session` con **exactamente las columnas que better-auth inserta** —`id text`
      PK, `token text NOT NULL UNIQUE`, `user_id uuid NOT NULL REFERENCES app_user (id)`,
      `expires_at`, `created_at`, `updated_at`, `ip_address`, `user_agent`— más las nuestras, que
      **tienen que ser anulables o traer default** porque su `INSERT` no las nombra:
      `purpose text NOT NULL DEFAULT 'full'` con `CHECK (purpose IN ('full','enrol_two_factor'))`
      (design D7), `revoked_at timestamptz`, `revoked_reason text`.
- [x] 3.2 Crear `app_refresh_token` (design D6): `id uuid` PK,
      `session_id text NOT NULL REFERENCES app_session (id)`, `token_hash text NOT NULL UNIQUE`,
      `parent_id uuid REFERENCES app_refresh_token (id)` para la cadena de rotación,
      `issued_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`,
      `spent_at timestamptz`, `replaced_by_id uuid REFERENCES app_refresh_token (id)` para poder
      devolver el mismo par dentro de la ventana de gracia, `revoked_at timestamptz`.
- [x] 3.3 Comentar en las dos tablas por qué el token de refresh va **hasheado** y por qué el de
      acceso es opaco y no un JWT (design D3): el alcance no se congela y una base robada no da
      sesiones. Comentar también por qué el refresh no vive en `app_session` (design D6).
- [x] 3.4 Índices: `app_session (token)` —el lookup de cada request— y
      `(user_id) WHERE revoked_at IS NULL` para la revocación en masa de 5.6;
      `app_refresh_token (token_hash)` y `(session_id)`.
- [x] 3.5 Triggers `BEFORE UPDATE`: en `app_session` rechazar con `HS001` todo cambio de `id`,
      `user_id`, `token`, `purpose` y `created_at` — mutable es `expires_at`, `updated_at`,
      `revoked_at` y `revoked_reason`, y `updated_at` está en la lista porque better-auth la
      reescribe en cada `UPDATE`; en `app_refresh_token`, mutable solo `spent_at`,
      `replaced_by_id` y `revoked_at`.
- [x] 3.6 Triggers `BEFORE DELETE`/`BEFORE TRUNCATE` con `hs_forbid_mutation()` sobre las dos: una
      sesión se revoca, nunca se borra. Es la red de abajo de design D15 — la barrera que sí
      produce un error visible es el hook, y su prueba es 9.7.
- [x] 3.7 `GRANT SELECT, INSERT` sobre las dos;
      `GRANT UPDATE (expires_at, updated_at, revoked_at, revoked_reason) ON app_session` y
      `GRANT UPDATE (spent_at, replaced_by_id, revoked_at) ON app_refresh_token` a `hs_app`.
- [x] 3.8 Crear `app_verification` según lo que el spike (1.2) haya determinado que better-auth
      necesita, con el mismo tratamiento: sin `DELETE`, `UPDATE` acotado. Si el spike concluye que
      no hace falta, no crearla y dejar comentado en la migración que se omitió a propósito y por
      qué.
- [x] 3.9 Comentar explícitamente que **ninguna** de las tablas de este change lleva política RLS,
      con el razonamiento de design D13 y la consecuencia declarada: cualquier rol conectado puede
      leer la tabla de sesiones, y por eso los tokens están hasheados.

## 4. Migración `0006` — auditoría y ventana de fechas

- [x] 4.1 Agregar los tipos de evento de autenticación al vocabulario de `event_type` que ya usa
      `audit_log`, en el mismo lugar y con el mismo formato que los de `0005`.
- [x] 4.2 Triggers de fan-out reusando `hs_account_audit_fanout()` de `0005` (design D11) sobre
      `user_invitation` (alta, aceptación, revocación), `app_credential` (alta, revocación) y
      `app_two_factor` (confirmación, revocación). Diferidos a `COMMIT`, como el de alta de cuenta,
      para encontrar el alcance ya otorgado.
- [x] 4.3 Crear la función que escribe un evento de autenticación **sin fila propia** —login
      exitoso, login fallido con su categoría de motivo, bloqueo— con el mismo fan-out por sitio.
      Comentar por qué estos no pueden ir por trigger (design D11) y que el `payload` no lleva
      nunca la contraseña, su hash ni el código TOTP.
- [x] 4.4 Escribir `hs_apply_record_window(regclass, text)` (design D12): agrega a la tabla
      indicada una política que acota la columna de fecha nombrada contra `app.records_from` y
      `app.records_to`, con la misma forma que `hs_apply_site_isolation` — sin settings
      declarados, la política no acota nada, para que las sesiones que no son de auditor no
      cambien de comportamiento.
- [x] 4.5 Aplicar `hs_apply_record_window('audit_log', 'occurred_at')` y comentar que hoy es su
      único consumidor porque las tablas que un auditor va a leer son de las etapas 3 a 6, y que
      cada change que cree una tiene que pasarla por este helper.
- [x] 4.6 Registrar `0006` a mano en `apps/api/drizzle/meta/_journal.json`.

## 5. Módulo de autenticación en `apps/api`

- [x] 5.1 Montar better-auth como módulo de NestJS con la configuración validada en 1.2, y las
      vidas de token de design D6: access 15 minutos, refresh 14 días. **Sin montar su router
      HTTP** (design D16): se usa `auth.$context.password` para la credencial y el mapeo de modelos
      para que sepa leer las tablas; la sesión la insertamos nosotros con su `purpose` ya puesto.
- [x] 5.2 Implementar el guard de sesión con la resolución de design D4 en una sola consulta:
      sesión viva y no vencida → cuenta activa y no vencida → `person_id` → `role` → `site_ids` de
      los `user_site_scope` activos. El objeto resultante es lo que ADR-011 llama la sesión.
- [x] 5.3 Implementar los tres desenlaces de design D5 como respuestas tipadas: `401` +
      `token_expired` (renovable), `401` + `session_ended` (final), `403` (ni refresca ni
      reintenta). El código va en el cuerpo y su tipo vive en `packages/contracts`.
- [x] 5.4 Cambiar la firma de `withSiteScope` (`apps/api/src/db/site-scope.ts`) para que reciba la
      sesión y fije `app.site_ids`, `app.user_id` y —cuando el rol es `external_auditor`—
      `app.records_from` y `app.records_to`. Dejar la entrada de alcance explícito como función
      distinta para scripts y tests, **no** como parámetro opcional de la misma (design D4).
- [x] 5.5 Implementar el refresh rotativo de design D6: nuevo par en cada uso, el presentado
      marcado con `spent_at`, y reuso fuera de la ventana de gracia de 60 segundos revoca la
      cadena entera vía `parent_session_id`. Dentro de la ventana, devolver el mismo par sin
      revocar nada.
- [x] 5.6 Implementar la revocación en cascada: desactivar una cuenta, vencer su `expires_at`,
      revocarle la credencial o reiniciarle el segundo factor revoca todas sus `app_session`
      vivas, con `revoked_reason`.
- [x] 5.7 Implementar el modo de sesión limitada de design D7: `purpose = 'enrol_two_factor'` para
      `hs_coordinator` y `management` sin `app_two_factor` confirmado; el guard la acepta en la
      **lista blanca** de dos rutas y la rechaza con `403` en todas las demás; confirmar el TOTP
      revoca esa sesión y obliga a un login nuevo con código.
- [x] 5.8 Implementar el bloqueo por intentos fallidos de design D8 contra
      `app_credential.failed_attempts`/`locked_until`: umbral 5, bloqueo 15 minutos, contador a
      cero en el login exitoso. Los intentos contra un email inexistente se cuentan por IP en
      memoria y no crean ninguna fila.
- [x] 5.9 Implementar el registro de lecturas del auditor dentro de `withSiteScope` (design D10):
      cuando el rol es `external_auditor`, la misma transacción de la lectura escribe la entrada
      antes de cometer, con los identificadores devueltos y la ventana vigente.

## 6. Rutas

- [x] 6.1 Emitir invitación (`hs_coordinator` únicamente): valida que la cuenta exista y no tenga
      credencial activa, crea `user_invitation`, y devuelve el token en claro **una sola vez**
      (design D9). Rechazar cuando el destino es una `person` sin `app_user`.
- [x] 6.2 Revocar invitación (`hs_coordinator` únicamente): `revoked_at`, nunca `DELETE`.
- [x] 6.3 Aceptar invitación: sin sesión, valida token, vencimiento, `accepted_at` y `revoked_at`,
      fija la contraseña creando `app_credential` y marca `accepted_at`, todo en una transacción.
- [x] 6.4 Login: email + contraseña + código TOTP cuando corresponde. Respuesta idéntica para
      email desconocido y contraseña incorrecta. Sin sesión para cuenta desactivada, vencida o sin
      credencial, y sin revelar cuál de las tres.
- [x] 6.5 Refresh, logout, y revocación de las sesiones de otra cuenta (`hs_coordinator`).
- [x] 6.6 Emitir y confirmar el secreto TOTP — las dos únicas rutas de la lista blanca de 5.7 — y
      reinicio del segundo factor de otra cuenta (`hs_coordinator` únicamente). Rechazar que el
      titular de un rol obligatorio se quite el suyo.
- [x] 6.7 Ruta que devuelve la sesión resuelta (`user_id`, `person_id`, `role`, `site_scope`) para
      que `apps/web` sepa quién está adentro. Verificar que ninguna respuesta de ninguna ruta
      incluye `password_hash`, `secret`, `token_hash` ni los hashes de sesión.
- [x] 6.8 Verificar que ninguna ruta acepta un sitio, un alcance o un actor como parámetro,
      header o campo del cuerpo, y que la sesión de un `external_auditor` no es aceptada por
      ninguna ruta de escritura — hoy son cero, y el test es el que lo mantiene en cero.

## 7. Contratos y cliente

- [x] 7.1 En `packages/contracts`: esquemas Zod de login, refresh, invitación (con el default de
      72 horas de design D9), aceptación, TOTP, y el tipo de la sesión resuelta. Sin dependencias
      de Node.
- [x] 7.2 Los códigos de error de design D5 como unión tipada, compartida por las dos puntas: es
      lo que hace implementable el requisito offline y no puede ser un string suelto.
- [x] 7.3 En `apps/web`: cliente de sesión con almacenamiento del token, refresh silencioso, y el
      manejo de los tres desenlaces de D5.
- [x] 7.4 Exponer el gancho `ensureFreshSession()` que la etapa 3 tiene que llamar **antes** de
      vaciar el outbox, documentado con el requisito que cumple: una entrada de la cola nunca se
      descarta por un 401.
- [x] 7.5 Suscribir el refresh al evento de recuperación de conexión, de modo que reconectar
      renueve antes de que salga el primer envío diferido.

## 8. Alta de la primera credencial

- [x] 8.1 Comando de servidor —no seed (design, Migration Plan 3)— que emite una invitación para
      el coordinador de `004_bootstrap_coordinator.sql` e imprime el token una vez. Que la salida
      diga que es la única invitación del sistema emitida sin sesión de coordinador detrás.
- [x] 8.2 Verificar que `004_bootstrap_coordinator.sql` sigue sin credencial y que ese seed no
      cambia: la contraseña se fija aceptando la invitación, no sembrando un valor conocido en
      todos los entornos.
- [x] 8.3 Agregar el script al `package.json` de la raíz junto a `db:seed` y `roster:import`.

## 9. Suite de integración

- [x] 9.1 Ciclo completo de invitación: emisión por coordinador, rechazo para no-coordinadores,
      rechazo para cuenta que ya tiene credencial, vencida, ya aceptada, revocada, y el
      `DELETE` rechazado.
- [x] 9.2 Login: cuenta activa entra; desactivada, auditor vencido y cuenta sin credencial no; y
      email desconocido y contraseña incorrecta devuelven exactamente la misma respuesta.
- [x] 9.3 Bloqueo: cinco fallos bloquean, la contraseña correcta sigue rechazada durante el
      bloqueo, `deactivated_at` sigue nulo, y un login exitoso pone el contador en cero.
- [x] 9.4 TOTP: coordinador sin segundo factor recibe sesión limitada y es rechazado fuera de las
      dos rutas; inscribe y entra pleno; `jhsc_member` entra sin segundo factor; código inválido
      no da sesión; ascender una cuenta a `management` le corta el acceso pleno en el request
      siguiente; el titular no puede quitarse el suyo y el coordinador sí puede reiniciarlo.
- [x] 9.5 Alcance: la sesión resuelve `user_id`, `person_id` y `site_scope`; revocar un sitio lo
      saca del alcance en el request siguiente con el **mismo** token; otorgar uno lo agrega; una
      cuenta sin alcance activo responde sin error y no ve nada; un sitio pasado por el request no
      cambia `app.site_ids`; un actor pasado por el request no cambia `app.user_id`.
- [x] 9.6 Refresh: access vencido se renueva sin contraseña ni TOTP; el vencido responde
      `token_expired` y el revocado `session_ended`; cada refresh rota; reusar un token gastado
      revoca la cadena; reusarlo dentro de los 60 segundos de gracia devuelve el mismo par sin
      revocar; un refresh de 8 días de antigüedad —dentro de la ventana de ADR-010— sigue sirviendo.
- [x] 9.7 Revocación: desactivar la cuenta, vencer al auditor, revocar la credencial, reiniciar el
      segundo factor y el logout dejan `revoked_at` en las sesiones vivas; el `DELETE` de una
      sesión falla con `HS001`.
- [x] 9.8 Auditor: la ventana de fechas acota una lectura de `audit_log` por los dos lados; la
      ventana no amplía el alcance de sitio; ninguna ruta de escritura acepta su sesión.
- [x] 9.9 Auditoría de autenticación: login de cuenta de dos sitios deja una entrada en cada
      cadena y el de una, una sola; invitación, aceptación, inscripción y reinicio de TOTP,
      logout y revocación quedan registrados con el `actor_user_id` correcto; el fallo con cuenta
      real queda registrado sin la contraseña en el `payload`; el fallo con email inexistente no
      escribe ninguna entrada pero sí cuenta para el bloqueo; un login con rollback no deja
      entrada.
- [x] 9.10 Lecturas del auditor: una lectura suya escribe la entrada en la misma transacción;
      una que no devuelve nada también; una que cruza dos sitios escribe en las dos cadenas; la
      misma lectura hecha por coordinador o por `jhsc_member` no escribe ninguna.
- [x] 9.11 Verificar que la cadena de `audit_log` sigue íntegra después de `0006` con el
      verificador que ya existe: ningún hash cambió.

## 10. Cierre

- [x] 10.1 Reescribir al menos un test de integración existente para que declare el alcance
      iniciando sesión de verdad en vez de con un `set_config` a mano: es la propiedad que la
      etapa 2 de §7 tiene que dejar probada — "permisos por sitio verificados con datos reales".
- [x] 10.2 `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm --filter api test:int` en verde.
- [x] 10.3 Actualizar `docs/adr/011-authentication.md`: marcar el change que la implementa en la
      fila "Changes que la consumen", y anotar el resultado del spike de 1.2 —camino principal o
      plan B— que el propio ADR pide verificar.
