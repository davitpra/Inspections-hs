## 1. Dependencias y configuración de migraciones

- [x] 1.1 Agregar a `apps/api`: `drizzle-orm` y `pg` como dependencias; `drizzle-kit`,
      `@types/pg`, `testcontainers` y `@testcontainers/postgresql` como devDependencies.
- [x] 1.2 Crear `apps/api/drizzle.config.ts` apuntando a `MIGRATION_DATABASE_URL` y a
      `apps/api/drizzle/`, con un comentario que prohíbe `drizzle-kit generate` y explica por
      qué (una migración regenerada pierde `REVOKE`, triggers y políticas — ADR-004).
- [x] 1.3 Crear `apps/api/drizzle/meta/_journal.json` vacío y documentar en el propio config que
      el journal se mantiene a mano, una entrada por `.sql`.
- [x] 1.4 Agregar el script `db:migrate` en `apps/api/package.json` (aplica las migraciones como
      `hs_migrator`) y exponerlo desde el `package.json` raíz.

## 2. Migración 0001 — mecanismo de inmutabilidad

- [x] 2.1 Escribir `apps/api/drizzle/0001_immutability_mechanism.sql` con `hs_forbid_mutation()`:
      función trigger que hace `RAISE EXCEPTION` con `ERRCODE` propio del proyecto y un mensaje
      que nombra la tabla y declara que es append-only.
- [x] 2.2 Agregar `hs_make_immutable(regclass)`: instala el trigger `BEFORE UPDATE OR DELETE ...
      FOR EACH ROW`, el `BEFORE TRUNCATE ... FOR EACH STATEMENT`, y ejecuta
      `REVOKE UPDATE, DELETE, TRUNCATE ON <tabla> FROM hs_app`.
- [x] 2.3 Agregar `hs_apply_site_isolation(regclass)`: `ENABLE` + `FORCE ROW LEVEL SECURITY` y la
      política por sitio con `USING` y `WITH CHECK` sobre
      `site_id = ANY(string_to_array(current_setting('app.site_ids', true), ',')::uuid[])`.
- [x] 2.4 Registrar `0001` en `_journal.json` y verificar que la migración aplica limpia sobre una
      base recién creada con `pnpm db:reset && pnpm db:migrate`.

## 3. Migración 0002 — `audit_log` y cadena de hashes

- [x] 3.1 Escribir `apps/api/drizzle/0002_audit_log.sql` con la tabla `audit_log`: `id` identity,
      `site_id uuid NOT NULL` **sin FK** (la tabla `site` es de la etapa 2), `seq bigint NOT NULL`,
      `actor_user_id uuid`, `event_type text NOT NULL`, `payload jsonb NOT NULL`,
      `occurred_at timestamptz NOT NULL`, `recorded_at timestamptz NOT NULL`,
      `prev_hash bytea`, `hash bytea NOT NULL`.
- [x] 3.2 Agregar índice único `(site_id, seq)` e índice de lectura por `(site_id, recorded_at)`.
- [x] 3.3 Escribir `hs_audit_canonical(audit_log)`: serialización determinista de la fila. Los
      `timestamptz` van con `to_char(x AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`, nunca
      casteados a texto directo — el texto de un `timestamptz` depende de los GUC de la sesión.
- [x] 3.4 Escribir el trigger `BEFORE INSERT` de cadena: `pg_advisory_xact_lock` derivado del
      `site_id`, leer el último evento de ese sitio, asignar `seq`, `prev_hash`,
      `recorded_at = now()` y `hash = sha256(prev_hash || canónico)` con el `sha256()` nativo de
      Postgres 17. Sobrescribe siempre esos campos, ignorando lo que mande el caller.
- [x] 3.5 Escribir `hs_audit_verify_chain(uuid)`: recorre el sitio en orden de `seq`, recalcula
      con `hs_audit_canonical()` y devuelve el primer eslabón roto (o ninguna fila si está intacta).
- [x] 3.6 Cerrar la migración con `hs_make_immutable('audit_log')` y
      `hs_apply_site_isolation('audit_log')`, y registrar `0002` en `_journal.json`.

## 4. Acceso a datos desde la API

- [x] 4.1 Crear `apps/api/src/db/schema/audit-log.ts`: espejo Drizzle de la tabla, con un
      comentario aclarando que la fuente de verdad es el `.sql` y que este archivo solo aporta
      tipos.
- [x] 4.2 Crear el módulo de base de datos con el pool `pg` conectado con `DATABASE_URL` (rol
      `hs_app`) y el cliente Drizzle.
- [x] 4.3 Implementar el helper de contexto RLS: abre transacción, ejecuta `SET LOCAL
      app.site_ids` y `SET LOCAL app.user_id`, corre el callback y cierra. `SET LOCAL`, no `SET`
      — el alcance tiene que morir con la transacción o se filtra al siguiente request del pool.

## 5. Suite de integración con Testcontainers

- [x] 5.1 Crear `apps/api/vitest.integration.config.mts` con `include: ['test/**/*.int-spec.ts']`
      y `testTimeout` amplio. Config aparte: `vitest.config.mts` solo incluye `src/**/*.spec.ts` y
      los tests de funciones puras deben seguir corriendo en milisegundos.
- [x] 5.2 Escribir el helper de arranque del contenedor: `postgres:17-alpine`, montando **el mismo**
      `db/init/01-roles.sql` que usa `docker-compose.yml`, aplicando las migraciones como
      `hs_migrator` y devolviendo dos pools (`hs_app` y `hs_migrator`).
- [x] 5.3 Agregar el script `test:int` en `apps/api/package.json`.

## 6. Tests de aceptación

- [x] 6.1 `immutability`: `UPDATE` y `DELETE` sobre `audit_log` con el rol `hs_app` fallan con
      SQLSTATE `42501`, y la fila queda intacta. **Este es el spike 2 de requisitos §7.**
- [x] 6.2 `immutability`: `TRUNCATE` con `hs_app` falla; `CREATE TABLE` y `DROP TRIGGER` con
      `hs_app` fallan.
- [x] 6.3 `immutability`: `UPDATE` y `DELETE` con el rol `hs_migrator` —que es dueño de la tabla y
      por lo tanto sí tiene el privilegio— fallan por el trigger. Es la única forma de probar la
      segunda barrera: con `hs_app` el `REVOKE` dispara primero y el trigger nunca se ejecuta.
- [x] 6.4 `immutability`: `INSERT` con `hs_app` dentro del alcance de sitio funciona.
- [x] 6.5 `immutability`: con dos sitios cargados, alcance de un solo sitio ve solo sus filas;
      alcance de ambos ve las dos; `INSERT` fuera del alcance falla; sin alcance declarado la
      consulta devuelve cero filas.
- [x] 6.6 `immutability`: `hs_migrator` con alcance de un sitio tampoco ve el otro — prueba de que
      `FORCE ROW LEVEL SECURITY` está aplicado.
- [x] 6.7 `immutability`: una transacción declara alcance y termina; la siguiente transacción sobre
      la misma conexión del pool, sin declarar alcance, ve cero filas.
- [x] 6.8 `audit`: tres eventos de un sitio encadenan `prev_hash` → `hash`; el primero tiene
      `prev_hash` nulo; los sitios A y B mantienen cadenas independientes.
- [x] 6.9 `audit`: `hash` y `prev_hash` enviados por el caller se descartan; `recorded_at` es el
      del servidor aunque el caller mande otro; `occurred_at` se preserva verbatim aunque sea
      días anterior.
- [x] 6.10 `audit`: inserciones concurrentes del mismo sitio desde conexiones separadas producen
      `seq` distintos y una cadena sin bifurcar.
- [x] 6.11 `audit`: `hs_audit_verify_chain` no reporta nada sobre una cadena sana; reporta el
      eslabón correcto cuando se altera un `payload` fuera de banda (como superusuario) y cuando
      se elimina un evento del medio.

## 7. CI y cierre

- [x] 7.1 Agregar el job `integration` a `.github/workflows/ci.yml`: corre `pnpm --filter api
      test:int` después del build, en un job separado del de lint/typecheck.
- [x] 7.2 Verificar el pipeline completo en local: `pnpm db:reset && pnpm db:migrate &&
      pnpm -r build && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter api test:int`.
- [x] 7.3 Actualizar `.env.example` si aparece alguna variable nueva y confirmar que las dos URLs
      existentes quedaron en uso.
