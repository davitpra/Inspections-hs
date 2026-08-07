## 1. Migración 0004 — las dos tablas

- [x] 1.1 Crear `apps/api/drizzle/0004_site_location_catalog.sql` con `site`: `id uuid` PK,
      `code text NOT NULL UNIQUE` con `CHECK` de formato (minúsculas, dígitos, `.` y `-`),
      `name text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`,
      `deactivated_at timestamptz`. Dejar en el comentario por qué **no** lleva RLS (design D1).
- [x] 1.2 Agregar `location`: `id uuid` PK, `site_id uuid NOT NULL REFERENCES site(id)`,
      `code text NOT NULL` con el mismo `CHECK` de formato, `name text NOT NULL`,
      `created_at timestamptz NOT NULL DEFAULT now()`, `deactivated_at timestamptz`.
      Sin columna de padre, sin geometría, sin coordenadas — el spec lo exige explícitamente.
- [x] 1.3 Agregar `UNIQUE (site_id, code)` y `UNIQUE (site_id, id)`. Comentar que el segundo es
      redundante como restricción y existe para ser destino de la FK compuesta de design D3,
      con el `FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)` escrito en
      el comentario para quien cree `inspection` en la etapa 3.
- [x] 1.4 Agregar el índice único **parcial** de nombre activo:
      `CREATE UNIQUE INDEX location_site_active_name_uq ON location (site_id, name) WHERE
      deactivated_at IS NULL`, con el comentario de por qué es parcial (design D4).
- [x] 1.5 Índice de lectura del desplegable: `(site_id, name)` sobre las activas.

## 2. Migración 0004 — mutabilidad parcial y aislamiento

- [x] 2.1 Escribir el trigger `BEFORE UPDATE` de `location` que rechaza con SQLSTATE `HS001`
      cualquier cambio de `id`, `site_id`, `code` o `created_at`, nombrando la columna en el
      mensaje. `name` y `deactivated_at` pasan (design D5).
- [x] 2.2 Escribir el trigger `BEFORE DELETE` de `location` y de `site` que rechaza siempre con
      `HS001` — la baja es lógica y esta es la barrera que también alcanza a `hs_migrator`.
- [x] 2.3 Escribir el trigger `BEFORE UPDATE` de `site` con la misma lógica que 2.1: solo
      `name` y `deactivated_at`.
- [x] 2.4 `GRANT SELECT, INSERT ON location TO hs_app` y
      `GRANT UPDATE (name, deactivated_at) ON location TO hs_app`. Sin `DELETE`. Sobre `site`,
      solo `GRANT SELECT`: las dos plantas las siembra `hs_migrator`.
- [x] 2.5 Aplicar `hs_apply_site_isolation('location')`. Confirmar en el comentario que hace
      `FORCE ROW LEVEL SECURITY` y que por lo tanto los seeds tienen que declarar alcance
      (design D2). `site` no lleva política.
- [x] 2.6 Agregar la FK `audit_log_site_id_fkey` con
      `ALTER TABLE audit_log ADD CONSTRAINT ... FOREIGN KEY (site_id) REFERENCES site(id) ON
      DELETE NO ACTION`, comentando que sobre una tabla inmutable el DDL del dueño es legal y
      que la FK no entra en `hs_audit_canonical`, así que ningún hash cambia (design D7).

## 3. Migración 0004 — auditoría del catálogo por trigger

- [x] 3.1 Escribir `hs_catalog_audit()`: `AFTER INSERT OR UPDATE` por fila sobre `location`,
      que inserta en `audit_log` con el `site_id` de la ubicación,
      `actor_user_id = nullif(current_setting('app.user_id', true), '')::uuid`,
      `occurred_at = now()` y el `payload` con `location_id` y `code` (design D6).
- [x] 3.2 Derivar el `event_type` del cambio: creación, renombre (`name` distinto), baja
      (`deactivated_at` de null a no-null) y reactivación (de no-null a null). Un `UPDATE` que
      no cambia ninguno de los dos campos observables no escribe fila.
- [x] 3.3 En el renombre, incluir en el `payload` el `name` anterior y el nuevo. En baja y
      reactivación, incluir el `deactivated_at` resultante.
- [x] 3.4 Registrar `0004_site_location_catalog` en `apps/api/drizzle/meta/_journal.json` y
      verificar que aplica limpio con `pnpm db:reset && pnpm db:migrate`.

## 4. Espejo Drizzle y contratos

- [x] 4.1 Crear `apps/api/src/db/schema/catalog.ts` con `site` y `location`, con el mismo
      encabezado que `templates.ts`: la fuente de verdad es el `.sql`, este archivo es un
      espejo a mano y `drizzle-kit generate` está prohibido.
- [x] 4.2 Exportar los `$inferSelect` de las dos tablas y reexportar desde
      `apps/api/src/db/schema/index.ts`.
- [x] 4.3 Agregar a `packages/contracts` los esquemas Zod `siteSchema` y `locationSchema` y la
      forma de la entrada del desplegable (`id`, `code`, `name`), con el mismo regex de `code`
      que el `CHECK` de 1.1. Verificar que el paquete sigue sin dependencias de Node.
- [x] 4.4 Verificar que ningún contrato expone un campo de ubicación de texto libre — el spec
      lo exige — y que `apps/web` no importa nada de `apps/api` (regla de lint de ADR-007).

## 5. Seeds

- [x] 5.1 Crear `apps/api/seeds/002_sites.sql` con las dos plantas y **literales UUID fijos**
      (`st-thomas`, `glencoe`), idempotente con `ON CONFLICT (code) DO NOTHING`. Dejar escrito
      por qué los ids son fijos (design D2).
- [x] 5.2 Crear `apps/api/seeds/003_locations.sql` con el catálogo inicial de cada sitio,
      idempotente con `ON CONFLICT (site_id, code) DO NOTHING`. Nunca
      `ON CONFLICT DO UPDATE`: pisaría un `name` que el coordinador ya editó.
- [x] 5.3 En ese mismo archivo, declarar el alcance antes de los `INSERT` con
      `select set_config('app.site_ids', '<uuid st-thomas>,<uuid glencoe>', true)` y comentar
      que sin eso los `INSERT` los rechaza el `WITH CHECK` de la política, incluso corriendo
      como `hs_migrator`. **`true` y no `false`**: `scripts/seed.mjs` abre una transacción por
      archivo, y con `false` el alcance quedaría pegado a la conexión física después del
      COMMIT — el mismo bug de pooling contra el que advierte `src/db/site-scope.ts`.
- [x] 5.4 Verificar a mano: `pnpm db:reset && pnpm db:migrate && pnpm db:seed && pnpm db:seed`
      corre dos veces sin error, no duplica filas de `site` ni de `location`, y la segunda
      corrida no agrega filas nuevas a `audit_log`.

## 6. Integración — identidad, baja lógica y unicidad

- [x] 6.1 Crear `apps/api/test/catalog.int-spec.ts` sobre la infraestructura de Testcontainers
      ya existente, sembrando los dos sitios y un catálogo mínimo por sitio.
- [x] 6.2 `site`: `code` duplicado falla con violación de único; `UPDATE site SET code = ...`
      falla con `HS001`; `DELETE FROM site` como `hs_app` falla con `42501`.
- [x] 6.3 `location`: `site_id` nulo falla con violación de not-null; `site_id` inexistente
      falla con FK; `UPDATE location SET site_id = <el otro sitio>` falla con `HS001`.
- [x] 6.4 Mutabilidad parcial: renombrar como `hs_app` funciona y se relee; cambiar `code` como
      `hs_app` falla con `42501`; cambiar `code` como `hs_migrator` falla con `HS001` y el
      valor sigue igual al releerlo.
- [x] 6.5 Baja lógica: `DELETE` como `hs_app` falla con `42501` y como `hs_migrator` con
      `HS001`; con `deactivated_at` puesto, la consulta del desplegable devuelve las activas y
      no la desactivada.
- [x] 6.6 Unicidad: `(site_id, code)` duplicado falla; el mismo `code` en el otro sitio pasa;
      dos activas con el mismo `name` en el mismo sitio falla; el mismo `name` con la primera
      desactivada pasa; reactivar sobre un `name` ya tomado falla con violación de único.

## 7. Integración — aislamiento por sitio

- [x] 7.1 Con alcance de un solo sitio vía `withSiteScope`, `SELECT` de `location` devuelve solo
      las de ese sitio y ninguna del otro.
- [x] 7.2 Con alcance de los dos sitios, devuelve las de ambos.
- [x] 7.3 Sin declarar alcance, devuelve **cero filas y no lanza error** — afirmar las dos cosas,
      porque la forma de fallar de este bug es "el catálogo se ve vacío" (design, riesgos).
- [x] 7.4 Con alcance de un solo sitio, insertar una `location` del otro sitio es rechazado por
      la política.
- [x] 7.5 El mismo `SELECT` como `hs_migrator` con alcance de un solo sitio tampoco ve el otro —
      la prueba de que `FORCE ROW LEVEL SECURITY` está puesto.

## 8. Integración — integridad (sitio, ubicación) sobre el stub

- [x] 8.1 Extender `apps/api/test/fixtures/finding_stub.sql` con `site_id uuid NOT NULL` y
      `location_id uuid NOT NULL` más
      `FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)`, y ampliar el
      aviso de arriba del archivo para que cubra también estas dos columnas (design D8).
- [x] 8.2 Verificar que `apps/api/test/item-identity.int-spec.ts` sigue verde con las columnas
      nuevas — el spike 3 no cambia de aserción.
- [x] 8.3 Un hallazgo con `site_id` de St. Thomas y `location_id` de Glencoe falla con violación
      de FK, escrito directo contra la base y sin código de aplicación en el medio.
- [x] 8.4 Un hallazgo con sitio y ubicación del mismo sitio se inserta bien.
- [x] 8.5 Con la ubicación de ese hallazgo desactivada, releer el hallazgo sigue resolviendo su
      `code` y su `name` — el requisito que justifica que la baja sea lógica.

## 9. Integración — auditoría del catálogo

- [x] 9.1 Insertar una `location` escribe una fila de `audit_log` con el `site_id` de la
      ubicación, el `event_type` de creación y un `payload` con `location_id` y `code`.
- [x] 9.2 Renombrar escribe una fila cuyo `payload` contiene el `name` anterior y el nuevo.
- [x] 9.3 Desactivar y reactivar escriben dos filas con `event_type` distintos entre sí.
- [x] 9.4 Con `app.user_id` declarado en la transacción, el `actor_user_id` de la fila es ese
      usuario; en los seeds, es null.
- [x] 9.5 Un renombre dentro de una transacción que hace `ROLLBACK` no deja ninguna fila.
- [x] 9.6 `audit_log` con un `site_id` inexistente falla con FK; `hs_audit_verify_chain` sigue
      dando válido para las dos cadenas después de los eventos del catálogo.

## 9-bis. Consecuencia de la FK sobre los specs ya existentes

- [x] 9b.1 `audit-chain.int-spec.ts` e `immutability.int-spec.ts` escriben eventos contra
      `site_id` inventados. Con la FK de 2.6 eso deja de ser legal: registrar sus sitios en el
      `beforeAll` con un helper nuevo, `test/helpers/catalog.ts`.
- [x] 9b.2 Verificar que las dos suites siguen verdes sin cambiar ninguna aserción — lo que
      cambia es el arranque, no lo que prueban.

## 10. Cierre

- [x] 10.1 Correr `pnpm lint`, `pnpm test` y la suite de integración completa en limpio.
- [x] 10.2 Verificar que el glob `test/**/*.int-spec.ts` de `vitest.integration.config.mts`
      levanta el spec nuevo sin tocar la configuración ni el workflow.
- [x] 10.3 Actualizar el comentario de `site_id` en `apps/api/drizzle/0002_audit_log.sql` —
      decía que la FK la agrega la etapa 2 — para que apunte a `0004`. Sin cambiar el SQL de esa
      migración, que ya está aplicada.
- [x] 10.4 Agregar este change a "Changes que la consumen" en `docs/adr/004-postgres-drizzle-rls.md`:
      es la primera aplicación real de RLS y el ADR debería poder nombrar dónde mirar.
