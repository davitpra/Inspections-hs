## 1. El script

- [x] 1.1 Crear `apps/api/scripts/create-account.mjs` con la cabecera de intención que llevan
      los otros comandos de la familia: por qué es un comando y no un seed, por qué corre
      como `hs_app`, y por qué —a diferencia de `auth:bootstrap` y `auth:reset-password`—
      **no** se niega en producción (design, decisión 1). Conexión por `pg.Pool` sobre
      `DATABASE_URL`, igual que `bootstrap-invitation.mjs`.
- [x] 1.2 Parseo de argumentos: `--employee <employeeNumber>`, `--email`, `--role`,
      `--site <code>` (repetible) y `--actor <email|userId>`. Sin librería de CLI: el resto
      de los scripts leen `process.argv` a mano. Con `--help` y un uso de ejemplo.
- [x] 1.3 Rechazar `external_auditor` por nombre, con el mensaje que explica que el
      `CHECK app_user_auditor_lifecycle` exige `expires_at` (≤ 90 días), `records_from` y
      `records_to`, y que ese alta va por SQL (design, Non-Goals).

## 2. Comprobaciones previas

> **Corregido durante la implementación.** El design decía "todas antes de abrir la
> transacción". No se puede: `person` lleva `hs_apply_site_isolation` con FORCE ROW LEVEL
> SECURITY, que alcanza a `hs_app`, así que sin alcance declarado la tabla se ve **vacía**
> y buscar a alguien por su número de empleado devuelve "no existe" para todo el mundo.
> Las comprobaciones que tocan `person` corren dentro de la misma transacción del alta,
> bajo el alcance del actor. Ver design, decisión 4.

- [x] 2.1 Resolver el actor por email o uuid: existe, `deactivated_at IS NULL`. Fallar
      nombrando qué se buscó.
- [x] 2.2 Resolver las plantas por `code` y comprobar que **todas** están en el alcance
      activo del actor. Es lo que evita el `HS002` que el trigger tiraría recién en
      `COMMIT`, sin decir de quién ni de qué planta habla (design, decisión 2).
- [x] 2.3 Resolver la persona por `employee_number`: existe y está activa. Si no, decir que
      la persona entra por `pnpm roster:import` — el comando no la crea.
- [x] 2.4 Comprobar que la persona no tiene ya una cuenta, y que el email no es de otra.
      Mensajes distintos, nombrando la cuenta que ya existe en cada caso: el mensaje del
      constraint no la nombra (design, decisión 5).
- [x] 2.5 Si la persona ya tiene cuenta con **estos mismos** datos, imprimir su `userId` y
      salir con 0 sin crear nada. Es la idempotencia que hace seguro repetir la corrida.
- [x] 2.6 Advertir —sin frenar— cuando un `jhsc_member` o un `supervisor` recibe las dos
      plantas. La spec es explícita en que el alcance es propiedad de las filas otorgadas y
      no del rol (`identity/spec.md:301`).

## 3. La transacción

- [x] 3.1 `BEGIN`, `set_config('app.site_ids', <las plantas a otorgar>, true)`,
      `set_config('app.user_id', <actor>, true)`, `INSERT app_user`, un `INSERT
      user_site_scope` por planta, `COMMIT`. En ese orden y en una sola transacción: el
      trigger `hs_account_audit_fanout()` está diferido a `COMMIT` para encontrar el alcance
      ya otorgado, y separarlo produce un alta sin auditoría.
- [x] 3.2 `ROLLBACK` en el `catch` y `release()` en el `finally`, como `demo-data.mjs`.
- [x] 3.3 Imprimir el resumen —`userId`, email, rol, plantas otorgadas, actor— y la línea
      `pnpm auth:bootstrap <userId>` lista para copiar (design, decisión 6).

## 4. Cableado

- [x] 4.1 `auth:create-account` en `apps/api/package.json`, con
      `node --env-file-if-exists=../../.env`, igual que sus vecinos.
- [x] 4.2 `auth:create-account` en el `package.json` de la raíz, delegando con `--filter api`.

## 5. Verificación contra la base real

- [x] 5.1 Alta feliz de un `jhsc_member` en una planta, contra el entorno local. Comprobar
      que la cuenta existe, que su alcance es el otorgado y que **no** tiene credencial.
- [x] 5.2 **Comprobar la auditoría**, que es lo único que ningún test de tipos habría visto:
      que existe una entrada de alta en la cadena de cada planta del alcance, con el
      `actor_user_id` del `--actor`.
- [x] 5.3 Los caminos de fallo, uno por uno: persona inexistente, persona con cuenta, email
      tomado, planta fuera del alcance del actor, rol inválido, `external_auditor`. Cada uno
      tiene que fallar **antes** de la transacción y con su propio mensaje.
- [x] 5.4 Correrlo dos veces con los mismos datos: la segunda no crea nada y sale con 0.
- [x] 5.5 Encadenar `pnpm auth:bootstrap <userId>` con el id que imprimió y aceptar la
      invitación en `/accept-invitation`, cerrando el alta de punta a punta.

## 6. Documentación

- [x] 6.1 README: la sección "Dar de alta a alguien" cambia el bloque de SQL por el comando;
      el paso 1 deja de ser "todavía por SQL".
- [x] 6.2 README: fila nueva en la tabla de comandos, y sacar "Crear la cuenta" de "Lo que
      todavía no tiene UI" — queda solo "Emitir la invitación".
- [x] 6.3 Anotar en el README que este es el único `auth:*` que corre en producción, con el
      motivo en una línea (no siembra credenciales).

## 7. Cierre

- [x] 7.1 `pnpm lint` sobre el script nuevo.
- [x] 7.2 `openspec validate account-provisioning-command`.
- [x] 7.3 Archivar con `/opsx:archive`.
