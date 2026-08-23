## 1. Migración

- [x] 1.1 Escribir `apps/api/drizzle/0027_site_audit_scope_guard.sql` con un solo
      `CREATE OR REPLACE FUNCTION hs_site_audit()`, partiendo de la versión vigente
      —`0026_reactivate_site.sql`, no `0023`— y conservando las cuatro ramas y sus payloads.
- [x] 1.2 Rama `INSERT`: reemplazar el `set_config('app.site_ids', NEW.id::text, true)` que
      PISA por uno que ENSANCHE —`array_to_string(hs_declared_sites() || NEW.id, ',')`—,
      conservando el `IF NOT (NEW.id = ANY (hs_declared_sites()))` que lo hace idempotente
      cuando el servicio ya declaró el id.
- [x] 1.3 Camino de `UPDATE`: antes del primer `INSERT INTO audit_log`, si
      `NOT (NEW.id = ANY (hs_declared_sites()))`, `RAISE EXCEPTION` con `ERRCODE = 'HS013'`
      nombrando la planta, con un `HINT` que nombre `app.site_ids`.
- [x] 1.4 Sin `DROP TRIGGER` / `CREATE TRIGGER`, y decir en el comentario por qué no hace
      falta: el trigger ya apunta a la función. `0023` y `0026` lo recrean y la diferencia
      se leería como olvido.
- [x] 1.5 Registrar la migración en `apps/api/drizzle/meta/_journal.json`.

## 2. Tests

- [x] 2.1 En `apps/api/test/catalog.int-spec.ts`, junto a los tests de auditoría de planta
      que ya existen: la baja sin alcance declarado se rechaza con `HS013`, no deja entrada
      y no mueve `deactivated_at`.
- [x] 2.2 El renombre con OTRA planta declarada se rechaza igual, y el nombre no se mueve.
- [x] 2.3 El alta sin alcance declarado sigue funcionando y escribe `site.created`.
- [x] 2.4 Una sentencia que inserta dos plantas deja las DOS declaradas —es la regresión que
      el pisado producía— y escribe una entrada en cada cadena.
- [x] 2.5 El alta conserva el alcance que la transacción ya tenía.

## 3. Seeds

- [x] 3.1 Ampliar el comentario de `apps/api/seeds/002_sites.sql` para decir qué queda
      declarado al terminar el archivo. Es donde ya se explica por qué los ids son
      literales, así que es donde alguien va a buscarlo.

## 4. Cierre

- [x] 4.1 `pnpm db:migrate` sobre una base ya migrada y `pnpm db:seed` dos veces sobre una
      fresca: idempotente, y las dos plantas auditadas.
- [x] 4.2 `pnpm --filter api test:int` completo, incluida
      `test/scheduling-console.int-spec.ts`, que es la suite que abrió este hilo.
- [x] 4.3 `pnpm -r build && pnpm typecheck && pnpm lint`.
- [x] 4.4 `openspec validate site-audit-scope-guard --strict`.
