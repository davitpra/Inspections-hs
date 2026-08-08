## 1. Migración 0005 — `person`

- [x] 1.1 Crear `apps/api/drizzle/0005_identity.sql` con el encabezado del proyecto: qué etapa de
      §7 cierra, qué pregunta cerrada implementa (3), los SQLSTATE que usa y la advertencia de que
      está escrita a mano porque `drizzle-kit generate` está prohibido (ADR-004).
- [x] 1.2 Crear `person`: `id uuid` PK, `employee_number text NOT NULL UNIQUE` con `CHECK` de
      formato (sin espacios, no vacío), `first_name text NOT NULL` y `last_name text NOT NULL`
      con `CHECK` de no-vacío, `site_id uuid NOT NULL REFERENCES site (id)`,
      `created_at timestamptz NOT NULL DEFAULT now()`, `deactivated_at timestamptz`. Dejar
      comentado que el nombre **no** identifica: dos personas activas pueden llamarse igual.
- [x] 1.3 Índice de lectura del selector de sujeto: `(site_id, last_name, first_name)` parcial
      `WHERE deactivated_at IS NULL`.
- [x] 1.4 Trigger `BEFORE UPDATE` de `person` que rechaza con `HS001` cualquier cambio de `id`,
      `employee_number` o `created_at`, nombrando la columna en el mensaje. `first_name`,
      `last_name`, `site_id` y `deactivated_at` pasan (design D8).
- [x] 1.5 Trigger `BEFORE DELETE` y `BEFORE TRUNCATE` reusando `hs_forbid_mutation()` de 0001 —
      la baja es lógica y esta es la barrera que también alcanza a `hs_migrator`.
- [x] 1.6 `GRANT SELECT, INSERT ON person TO hs_app` y
      `GRANT UPDATE (first_name, last_name, site_id, deactivated_at) ON person TO hs_app`. Sin
      `DELETE`, nunca.
- [x] 1.7 `SELECT hs_apply_site_isolation('person')`. Comentar que el `WITH CHECK` es lo que hace
      que una transferencia solo la pueda hacer quien tiene las dos plantas en su alcance, sin que
      ningún endpoint lo verifique (design D8).
- [x] 1.8 Comentar en la migración, con la palabra "a propósito", que `person` **no** lleva
      `UNIQUE (site_id, id)` ni va a ser destino de una FK compuesta, y por qué: `site_id` es
      mutable y la FK congelaría el par para siempre (design D9).

## 2. Migración 0005 — `app_user` y `user_site_scope`

- [x] 2.1 Crear `app_user`: `id uuid` PK, `person_id uuid NOT NULL UNIQUE REFERENCES person (id)`,
      `email text NOT NULL UNIQUE` normalizado a minúsculas por un `BEFORE INSERT OR UPDATE`
      —**no** por un `CHECK (email = lower(email))`: el spec exige que una segunda capitalización
      del mismo buzón falle con violación de **único**, y un `CHECK` se evalúa antes del índice y
      fallaría con violación de check— más `CHECK` de formato mínimo (contiene `@`),
      `role text NOT NULL`, `expires_at timestamptz`, `records_from date`,
      `records_to date`, `created_at timestamptz NOT NULL DEFAULT now()`,
      `deactivated_at timestamptz`. Comentar por qué la tabla se llama `app_user` (design D1) y
      por qué el email vive acá una sola vez (design D2).
- [x] 2.2 `CHECK` del rol cerrado sobre los cinco valores
      (`hs_coordinator`, `jhsc_member`, `supervisor`, `management`, `external_auditor`), con el
      comentario de por qué es `CHECK` y no `ENUM` ni tabla, y de que `inspector` no es un rol
      (design D5, nota de vocabulario de §4).
- [x] 2.3 `CHECK` del ciclo de vida del auditor externo, exactamente el de design D6: `expires_at`
      y la ventana `records_from`/`records_to` obligatorias para `external_auditor` y nulas para
      el resto, `expires_at <= created_at + interval '90 days'`,
      `records_from <= records_to`. Comentar que el default de 30 días vive en el contrato Zod
      porque el motor no distingue "no lo pusiste" de "pusiste 30".
- [x] 2.4 Crear `user_site_scope`: `id uuid` PK, `user_id uuid NOT NULL REFERENCES app_user (id)`,
      `site_id uuid NOT NULL REFERENCES site (id)`,
      `granted_at timestamptz NOT NULL DEFAULT now()`, `revoked_at timestamptz`, más el único
      **parcial** `UNIQUE (user_id, site_id) WHERE revoked_at IS NULL` (design D4).
- [x] 2.5 Triggers `BEFORE UPDATE` de las dos tablas: en `app_user` rechazar con `HS001` todo
      cambio de `id`, `person_id`, `created_at`; en `user_site_scope` todo cambio de `id`,
      `user_id`, `site_id`, `granted_at`. Lo único mutable de `user_site_scope` es `revoked_at`.
- [x] 2.6 Triggers `BEFORE DELETE`/`BEFORE TRUNCATE` con `hs_forbid_mutation()` sobre las dos:
      revocar es `UPDATE revoked_at`, nunca `DELETE`.
- [x] 2.7 `GRANT SELECT, INSERT` sobre las dos;
      `GRANT UPDATE (email, role, expires_at, records_from, records_to, deactivated_at) ON app_user`
      y `GRANT UPDATE (revoked_at) ON user_site_scope` a `hs_app`.
- [x] 2.8 Comentar explícitamente que ninguna de las dos lleva política RLS, con el razonamiento
      de design D3 y la consecuencia declarada: cualquier rol conectado puede leer la lista de
      cuentas, y cerrarlo es del primer endpoint de administración.
- [x] 2.9 Verificar por inspección que `app_user` no declara ninguna columna de contraseña, hash,
      salt, token, sesión ni secreto TOTP — el spec lo exige y es lo que separa este change del
      de auth.
- [x] 2.10 Definir el predicado compartido de cuenta activa
      (`deactivated_at IS NULL AND (expires_at IS NULL OR expires_at > now())`) como vista o
      función, para que no se copie en cada consulta (design D6).

## 3. Migración 0005 — importaciones del roster

- [x] 3.1 Crear `roster_import`: `id uuid` PK, `imported_by uuid REFERENCES app_user (id)`,
      `source_filename text NOT NULL`, `rows_read int NOT NULL`, `rows_applied int NOT NULL`,
      `rows_rejected int NOT NULL` con `CHECK (rows_read = rows_applied + rows_rejected)`,
      `started_at timestamptz NOT NULL`, `finished_at timestamptz NOT NULL DEFAULT now()`.
- [x] 3.2 Crear `roster_import_rejection`: `id uuid` PK,
      `import_id uuid NOT NULL REFERENCES roster_import (id)`, `row_number int NOT NULL` (1-based
      sobre el archivo), `employee_number text`, `reason text NOT NULL`, `raw_row jsonb NOT NULL`,
      más `UNIQUE (import_id, row_number)`.
- [x] 3.3 Aplicar `hs_make_immutable` a las dos: un reporte de importación que se puede editar no
      es un reporte. Sin RLS: un archivo puede traer filas de los dos sitios (design D3).
- [x] 3.4 Verificar que los `GRANT` que quedan sobre las dos son `SELECT` e `INSERT`, que es lo
      que dan los default privileges de `db/init/01-roles.sql`.
- [x] 3.5 Agregar `roster_import_site`: `import_id`, `site_id`, `rows_applied`, `rows_rejected`,
      `UNIQUE (import_id, site_id)`, también inmutable. Existe porque `audit_log.site_id` es
      `NOT NULL`: la entrada de resumen por planta necesita un sitio y unos contadores, y con esta
      fila los escribe un trigger a partir de un dato en vez de un parámetro que el importador
      tiene que acordarse de pasar (design D7, aplicado al resumen de importación).

## 4. Migración 0005 — auditoría por trigger

- [x] 4.1 Escribir `hs_person_audit()`: `AFTER INSERT OR UPDATE` por fila sobre `person`, con el
      mismo patrón que `hs_catalog_audit()` de 0004 — actor desde `app.user_id`, `occurred_at` y
      `recorded_at` en `now()`, `hash` de relleno que sobrescribe el trigger de la cadena.
- [x] 4.2 Derivar el `event_type` del cambio: creación, renombre (`first_name` o `last_name`
      distintos), transferencia (`site_id` distinto), baja y reactivación. Un `UPDATE` que no
      cambia nada observable no escribe fila.
- [x] 4.3 En la transferencia, escribir **dos** filas: una en la cadena del sitio que se deja y
      otra en la del sitio al que se llega, ambas con el sitio de origen y el de destino en el
      `payload`.
- [x] 4.4 Escribir `hs_account_audit()` sobre `app_user`: creación, cambio de `role`, cambio de
      `email`, baja y reactivación. Recorrer el alcance activo de la cuenta en
      `user_site_scope` y escribir **una fila por sitio** (design D7). Escribirlo como bucle sobre
      el alcance, no como dos ramas cableadas.
- [x] 4.5 Comentar en `hs_account_audit()`, con la consecuencia declarada, que una cuenta sin
      alcance activo no escribe ninguna entrada porque no alcanza ninguna planta — no es un hueco,
      y hay un escenario del spec que lo fija.
- [x] 4.6 Escribir `hs_scope_audit()` sobre `user_site_scope`: el otorgamiento y la revocación van
      **solo** a la cadena del sitio otorgado o revocado, con el `user_id` y el `role` en el
      `payload`.
- [x] 4.7 Agregar la FK `audit_log_actor_user_id_fkey` con
      `ALTER TABLE audit_log ADD CONSTRAINT ... FOREIGN KEY (actor_user_id) REFERENCES app_user (id) ON DELETE NO ACTION`,
      comentando que la columna sigue nullable, que el DDL del dueño sobre una tabla inmutable es
      legal y que `actor_user_id` ya entra en `hs_audit_canonical` con el mismo valor, así que
      ningún hash cambia (design D13).
- [x] 4.8 Registrar `0005_identity` en `apps/api/drizzle/meta/_journal.json` y verificar que
      aplica limpio con `pnpm db:reset && pnpm db:migrate`.

## 5. Espejo Drizzle y contratos

- [x] 5.1 Crear `apps/api/src/db/schema/identity.ts` con `person`, `appUser`, `userSiteScope`,
      `rosterImport` y `rosterImportRejection`, con el mismo encabezado que `catalog.ts`: la
      fuente de verdad es el `.sql` y este archivo es un espejo a mano.
- [x] 5.2 Exportar los `$inferSelect` de las cinco tablas y los tipos de actualización acotada
      (`PersonUpdate`, `AppUserUpdate`), y reexportar desde `apps/api/src/db/schema/index.ts`.
- [x] 5.3 Agregar `packages/contracts/src/identity.ts` con `roleSchema` (los cinco valores),
      `personSchema`, `accountSchema`, la entrada del selector de sujeto (`id`,
      `employee_number`, `first_name`, `last_name`) y el esquema del alcance. Reexportar desde
      `index.ts`.
- [x] 5.4 Agregar en el mismo archivo `rosterCsvRowSchema` (las cinco columnas y `status` en
      `{active, inactive}`) y `rosterImportReportSchema` (contadores más la lista de rechazos con
      `row_number`, `employee_number`, `reason`).
- [x] 5.5 Poner el default de 30 días y el máximo de 90 del auditor externo en el contrato Zod,
      con un test unitario que verifique que 91 días no valida (design D6).
- [x] 5.6 Verificar que `packages/contracts` sigue sin dependencias de Node y que `apps/web` no
      importa nada de `apps/api` (regla de lint de ADR-007).

## 6. Importador de roster

- [x] 6.1 Agregar un parser de CSV real como dependencia de `apps/api` — nada de `split(',')`:
      los apellidos con coma entre comillas y los `\r\n` de un export de Excel son el caso normal.
      Descartar el BOM de UTF-8 si viene.
- [x] 6.2 Escribir `apps/api/src/roster/parse-roster-csv.ts` con `parseRosterCsv(text)`: función
      **pura**, sin base de datos y sin NestJS, que devuelve `{ rows, rejections }` (design D10).
- [x] 6.3 Validar en el parser: encabezado con las cinco columnas por nombre y en cualquier orden;
      falta de columna requerida ⇒ el archivo entero no corre y se reporta el motivo;
      `employee_number` vacío o malformado, `first_name`/`last_name` vacíos, `status` fuera de
      `{active, inactive}` y `employee_number` duplicado dentro del archivo ⇒ rechazo de esa fila
      con su número 1-based.
- [x] 6.4 Escribir `apps/api/src/roster/apply-roster.ts` con `applyRoster(rows, scope)`: una sola
      lectura de `site` al inicio para resolver `site_code` y detectar sitio inexistente o fuera
      del alcance **antes** de escribir — nada de `INSERT` fallido y `catch`, que aborta la
      transacción entera (design D11).
- [x] 6.5 Upsert por `employee_number` con
      `ON CONFLICT (employee_number) DO UPDATE SET first_name, last_name, site_id, deactivated_at`,
      y `deactivated_at` derivado **solo** del `status` de la fila presente. Comentar que la
      ausencia del archivo nunca da de baja, con el caso del export con filtro puesto (design D12).
- [x] 6.6 Escribir `roster_import` y sus `roster_import_rejection` en la **misma** transacción que
      las filas aplicadas, con `withSiteScope` declarando el alcance del importador.
- [x] 6.7 Escribir la entrada de auditoría de resumen por cada sitio tocado, con el nombre del
      archivo y los contadores de ese sitio.
- [x] 6.8 Crear `apps/api/scripts/roster-import.mjs` y el script `roster:import` en
      `apps/api/package.json` (y su atajo en la raíz), que imprime el reporte legible: leídas,
      aplicadas, rechazadas y una línea por rechazo con número de fila y motivo.
- [x] 6.9 Tests unitarios de `parseRosterCsv` sin Postgres: archivo limpio, columnas en otro
      orden, columna faltante, comillas con coma, CRLF, BOM, duplicado interno, `status`
      inválido, archivo con solo encabezado.

## 7. Seeds y fixtures

- [x] 7.1 Crear `apps/api/seeds/004_bootstrap_coordinator.sql`: una `person` y un `app_user` con
      rol `hs_coordinator`, alcance a los dos sitios y sin credenciales, con UUID fijos e
      idempotente con `ON CONFLICT DO NOTHING`. Declarar `app.site_ids` con
      `set_config(..., true)` antes del `INSERT` de `person`, como hace `003_locations.sql`.
- [x] 7.2 Dejar escrito en el archivo por qué existe: sin una primera cuenta, el change de auth no
      tiene a quién invitar, y es lo único que rompe el huevo y la gallina.
- [x] 7.3 Extender `apps/api/test/helpers/` con un helper que siembre una persona y una cuenta y
      devuelva su id, para usar como `app.user_id` en toda la suite.
- [x] 7.4 Reemplazar en `audit-chain.int-spec.ts`, `immutability.int-spec.ts` y
      `catalog.int-spec.ts` el `app.user_id` inventado por el de la cuenta sembrada, y verificar
      que las tres suites siguen verdes **sin cambiar ninguna aserción** — lo que cambia es el
      arranque, no lo que prueban (design D13).
- [x] 7.5 Verificar a mano que `pnpm db:reset && pnpm db:migrate && pnpm db:seed && pnpm db:seed`
      corre dos veces sin error, no duplica filas y la segunda corrida no agrega entradas a
      `audit_log`.

## 8. Integración — persona: identidad, baja lógica y aislamiento

- [x] 8.1 Crear `apps/api/test/identity.int-spec.ts` sobre la infraestructura de Testcontainers
      existente, sembrando los dos sitios y un roster mínimo por sitio.
- [x] 8.2 `employee_number` duplicado falla con violación de único; cambiarlo falla con `HS001` y
      el valor sigue igual al releerlo; dos personas con el mismo nombre y distinto número entran
      las dos.
- [x] 8.3 `person` con `site_id` nulo es rechazada; corregir `first_name`/`last_name` como
      `hs_app` funciona y se relee.
- [x] 8.4 Baja lógica: `DELETE` como `hs_app` falla con `42501` y como `hs_migrator` con `HS001`;
      con `deactivated_at` puesto, la consulta del selector devuelve las activas y no la
      desactivada, y un registro que la referencia sigue resolviendo número y nombre.
- [x] 8.5 Aislamiento: con alcance de un sitio se ven solo sus personas; con los dos, ambas; sin
      declarar alcance, **cero filas y sin error** — afirmar las dos cosas.
- [x] 8.6 El mismo `SELECT` como `hs_migrator` con alcance de un sitio tampoco ve el otro
      (`FORCE ROW LEVEL SECURITY`).
- [x] 8.7 Transferencia: con alcance de los dos sitios, cambiar `site_id` funciona y la persona
      aparece en el roster del destino; con alcance de uno solo, el mismo `UPDATE` lo rechaza la
      política.

## 9. Integración — cuenta, rol y alcance

- [x] 9.1 `app_user` con `person_id` nulo falla con not-null; con `person_id` inexistente, con FK;
      una segunda cuenta para la misma persona falla con único; cambiar `person_id` falla con
      `HS001`.
- [x] 9.2 Email: duplicado falla; el mismo email con otra capitalización falla; el email de una
      cuenta desactivada sigue tomado; un email sin `@` falla con `CHECK`.
- [x] 9.3 Rol: `inspector` falla con `CHECK`; rol nulo falla con not-null; los cinco valores
      válidos entran.
- [x] 9.4 Auditor externo: sin `expires_at` falla; con 91 días falla; con 30 días entra; con
      `expires_at` en un rol que no es auditor falla; sin ventana de fechas falla; con la ventana
      invertida falla.
- [x] 9.5 Cuenta activa: una cuenta con `expires_at` en el pasado se reporta inactiva y su fila
      sigue presente con su alcance intacto; poner `deactivated_at` antes del vencimiento también
      la reporta inactiva.
- [x] 9.6 Bajas: `DELETE` de `app_user` falla con `42501` como `hs_app` y con `HS001` como
      `hs_migrator`; dar de baja una cuenta deja intacto el `deactivated_at` de su persona y la
      persona sigue en el selector.
- [x] 9.7 Alcance: otorgar y leer; grant duplicado activo falla con único; revocar saca el sitio
      del alcance efectivo y deja la fila con `granted_at` y `revoked_at`; volver a otorgar un
      sitio revocado entra y quedan las dos filas; `DELETE` de una fila de alcance falla;
      `site_id` inexistente falla con FK.
- [x] 9.8 El alcance manda y el rol no: una cuenta con rol `hs_coordinator` y sin alcance activo
      no ve ninguna fila de las tablas aisladas; un `jhsc_member` con un solo sitio no ve el otro.

## 10. Integración — auditoría de identidad

- [x] 10.1 Crear una `person` escribe una entrada con su `site_id`, el `event_type` de creación y
      un `payload` con `person_id` y `employee_number`.
- [x] 10.2 Renombrar escribe una entrada con el nombre anterior y el nuevo; desactivar y reactivar
      escriben dos entradas con `event_type` distintos.
- [x] 10.3 Transferir escribe **una entrada en cada cadena**, y las dos nombran origen y destino.
- [x] 10.4 Crear una cuenta con alcance a los dos sitios escribe una entrada en cada cadena, con
      `account_id`, `person_id` y `role` en el `payload`; una cuenta creada sin alcance activo no
      escribe ninguna.
- [x] 10.5 Cambiar `role` y cambiar `email` escriben una entrada por sitio del alcance, con el
      valor anterior y el nuevo.
- [x] 10.6 Otorgar un sitio escribe una entrada **solo** en la cadena de ese sitio, y no en la del
      otro; revocarlo escribe otra en la misma cadena.
- [x] 10.7 `audit_log` con un `actor_user_id` inexistente falla con FK; con null entra y se
      encadena; borrar una cuenta con entradas falla y quedan las dos cosas presentes.
- [x] 10.8 `hs_audit_verify_chain` sigue dando válido para las dos cadenas después de todos los
      eventos de identidad e importación.

## 11. Integración — importación del roster

- [x] 11.1 Importar un archivo limpio de dos sitios: se crean las personas, el reporte dice leídas
      = aplicadas y cero rechazos, y queda una fila de `roster_import`.
- [x] 11.2 Reimportar el mismo archivo sin cambios deja el roster idéntico y crea una segunda fila
      de `roster_import` — no duplica personas.
- [x] 11.3 Un archivo de 200 filas con 3 malas aplica 197, rechaza 3, y el reporte dice
      200/197/3 con el número de fila y el motivo de cada una.
- [x] 11.4 Cada clase de rechazo, con su motivo en el reporte: `employee_number` vacío,
      `site_code` inexistente, duplicado dentro del archivo (se aplica la primera y se rechaza la
      segunda), `status` inválido, y una fila que movería a alguien fuera del alcance del
      importador.
- [x] 11.5 Un archivo con 5 de las 200 personas deja a las otras 195 con su `deactivated_at`, su
      nombre y su `site_id` intactos — el escenario que justifica design D12.
- [x] 11.6 `status = inactive` da de baja y saca del selector sin romper las referencias;
      `status = active` sobre una persona dada de baja la reactiva.
- [x] 11.7 Un archivo con encabezado válido y sin filas corre bien, reporta 0/0/0 y no toca a
      nadie.
- [x] 11.8 Un fallo a mitad de la importación no deja ninguna persona creada ni modificada y
      ninguna fila de `roster_import` — provocarlo a propósito después de aplicar unas cuantas
      filas.
- [x] 11.9 `UPDATE` y `DELETE` sobre `roster_import` y `roster_import_rejection` fallan; la
      importación escribe una entrada de auditoría de resumen por cada sitio tocado, con el
      `actor_user_id` de la cuenta que la corrió.
- [x] 11.10 Medir y dejar anotado en el test cuánto tarda la importación de 200 filas con sus ~200
      entradas encadenadas, para que el número esté a la vista si algún día son 5.000 (design,
      riesgos).

## 12. Cierre

- [x] 12.1 Correr `pnpm lint`, `pnpm test` y la suite de integración completa en limpio.
- [x] 12.2 Verificar que el glob `test/**/*.int-spec.ts` levanta el spec nuevo sin tocar la
      configuración ni el workflow de CI.
- [x] 12.3 Actualizar el comentario de `actor_user_id` en `apps/api/drizzle/0002_audit_log.sql`
      para que apunte a `0005`, sin cambiar el SQL de esa migración, que ya está aplicada.
- [x] 12.4 Actualizar el comentario de `GRANT UPDATE (name, deactivated_at) ON location` en
      `0004_site_location_catalog.sql` — decía que el rol de coordinador lo trae `identity` — para
      que diga que el rol ya existe y que lo que falta es el endpoint que lo exija.
- [x] 12.5 Agregar este change a "Changes que la consumen" en `docs/adr/011-authentication.md`, y
      corregir ahí el nombre `identity-roster-csv-import` por el real. Anotar en el ADR que la
      identidad de dominio vive en `app_user` y que better-auth agrega credencial, sesión y TOTP
      sobre ella, sin una segunda copia del email (design D2).
