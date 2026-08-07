## Context

Ver `proposal.md` — Why. ADR aplicables: **ADR-002** (inmutabilidad forzada por el motor y
cadena de hashes), **ADR-004** (Postgres + Drizzle + RLS, migraciones escritas a mano),
**ADR-008** (módulo `audit` de la API, PITR como la otra mitad de la inmutabilidad).

Estado actual: `db/init/01-roles.sql` ya crea `hs_migrator` (dueño del schema) y `hs_app`
(runtime, `NOINHERIT`, `NOBYPASSRLS`, con default privileges de solo `SELECT, INSERT`). No hay
migraciones, ni Drizzle instalado, ni tests que toquen la base. Postgres 17.

**Este change toca una tabla inmutable: crea `audit_log`**, que nace inmutable y con política
RLS por sitio.

## Goals / Non-Goals

**Goals:**

- Que aplicar inmutabilidad y aislamiento por sitio a una tabla futura cueste dos llamados a
  función, no veinte líneas de SQL copiadas.
- Que la cadena de hashes sea infalsificable **desde la aplicación**, no solo difícil de
  falsificar.
- Que los seis escenarios de las specs corran en CI contra un Postgres real, con los mismos
  roles que se despliegan.

**Non-Goals:**

- Cualquier tabla de dominio. Ver `proposal.md` — What Changes.
- Autenticación y resolución de qué sitios corresponden a un usuario: acá el contexto RLS se
  fija a mano en los tests. La etapa 2 lo conecta al usuario real.
- Firma criptográfica con clave (HMAC, timestamping externo). La cadena detecta manipulación
  contra un lector honesto del log; no defiende contra un atacante con acceso de superusuario
  que recalcule la cadena entera. ADR-008 cubre ese flanco con PITR y versioning del bucket.

## Decisions

### Runner de migraciones: `drizzle-kit` sobre `.sql` escritos a mano

ADR-004 exige que las migraciones incluyan `REVOKE`, triggers y políticas. Nada de eso lo
genera un ORM a partir del esquema.

Se usa el runner de `drizzle-kit`/`migrate()` — que ya viene con el ORM elegido — pero los
`.sql` de `apps/api/drizzle/` se escriben a mano y el `meta/_journal.json` se mantiene a mano.
**`drizzle-kit generate` queda prohibido**, con un comentario en `drizzle.config.ts` que lo
explica: una migración regenerada borraría los `REVOKE` y las políticas sin avisar.

El archivo de esquema Drizzle (`src/db/schema/`) existe igual, porque el repositorio necesita
tipos para consultar, pero es un **espejo declarado** del SQL, no su fuente.

_Alternativas:_ un runner propio de ~60 líneas (control total, pero un segundo concepto de
migración conviviendo con Drizzle) y `node-pg-migrate` (maduro, pero una dependencia más para
resolver algo que el ORM ya trae). Ambas descartadas por el mismo motivo: una sola herramienta.

### Dos helpers SQL, no SQL repetido por tabla

`0001_immutability_mechanism.sql` define el mecanismo una vez:

| Función | Qué hace |
| --- | --- |
| `hs_forbid_mutation()` | Función trigger. `RAISE EXCEPTION` con `ERRCODE` propio del proyecto y un mensaje que nombra la tabla y dice que es append-only. |
| `hs_make_immutable(regclass)` | Instala el trigger `BEFORE UPDATE OR DELETE ... FOR EACH ROW` y uno `BEFORE TRUNCATE ... FOR EACH STATEMENT`, y hace `REVOKE UPDATE, DELETE, TRUNCATE ... FROM hs_app`. |
| `hs_apply_site_isolation(regclass)` | `ENABLE ROW LEVEL SECURITY`, **`FORCE ROW LEVEL SECURITY`** y la política por sitio, con `USING` y `WITH CHECK`. |

El `REVOKE` es redundante con los default privileges de `01-roles.sql` — que ya no otorgan
`UPDATE` ni `DELETE`. Se hace igual, explícito, porque los default privileges son un default y
alguna migración futura va a conceder `UPDATE` en alguna tabla mutable; el `REVOKE` deja la
intención escrita en la migración de la tabla que sí debe ser inmutable.

**El trigger no es decoración.** El `REVOKE` no alcanza por sí solo: `hs_migrator` es dueño de
las tablas y por lo tanto puede modificarlas siempre. El trigger es la única barrera que aplica
al rol que corre las migraciones, y por eso el test lo prueba **con ese rol**, no con `hs_app`
—donde el `REVOKE` dispara primero y el trigger nunca llega a ejecutarse.

### Aislamiento por sitio: `SET LOCAL` en la transacción, no `WHERE` en el endpoint

La política es:

```sql
site_id = ANY(string_to_array(current_setting('app.site_ids', true), ',')::uuid[])
```

`current_setting(..., true)` devuelve `NULL` cuando la variable no está fijada, y `= ANY(NULL)`
no matchea nada: **sin contexto declarado no se ve nada**, que es el default correcto. El mismo
predicado va en `WITH CHECK`, así que un `INSERT` fuera del alcance también se rechaza.

`FORCE ROW LEVEL SECURITY` no es opcional: sin él, `hs_migrator` —dueño de la tabla— evade sus
propias políticas. El comentario ya está anotado al pie de `db/init/01-roles.sql`.

El contexto se fija con `SET LOCAL`, que exige transacción y muere con ella. Es lo que impide
que una conexión del pool arrastre el alcance de un request al siguiente — el escenario
"Site scope does not leak between requests" de la spec existe para probar exactamente eso.
`SET` a secas o una variable de sesión serían un bug de seguridad silencioso bajo pooling.

### La cadena de hashes se calcula en un trigger `BEFORE INSERT`, no en Node

Tres razones, en orden de peso:

1. **La aplicación no puede forjar un eslabón.** Si Node calcula el hash, quien controla Node
   controla la cadena y la garantía se evapora.
2. **La serialización canónica sale gratis.** `jsonb` ya normaliza orden de claves, espacios y
   duplicados al almacenar; `payload::text` es determinista sin escribir un canonicalizador
   JSON en TypeScript ni mantenerlo sincronizado con el verificador.
3. **Postgres 17 trae `sha256(bytea)` nativo**, sin necesidad de `pgcrypto`.

El trigger, en orden: toma `pg_advisory_xact_lock` derivado del `site_id`, lee el último evento
de ese sitio, asigna `seq = último + 1` y `prev_hash = último.hash`, fija `recorded_at = now()`
y calcula `hash = sha256(prev_hash || canónico)`. Sobrescribe siempre los cuatro campos, así
que lo que mande el caller es irrelevante.

**Trampa de determinismo:** el texto de un `timestamptz` depende de los GUC `TimeZone` y
`DateStyle` de la sesión. Casteado a texto directo, la misma fila hashearía distinto según quién
la lea y la verificación fallaría sin que nadie haya tocado nada. La serialización canónica usa
`to_char(x AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`, y vive en una única función
`hs_audit_canonical()` que usan tanto el trigger como el verificador — si divergen, la
verificación miente.

_Lock por sitio y no global:_ dos sitios escriben en paralelo sin bloquearse, y la verificación
ante el MLITSD se pide por sitio, igual que el reporte de cumplimiento. El costo es que no hay
un orden total único del log; el orden global sigue disponible por `recorded_at`, que es
justamente para lo que el riesgo C lo define.

_Nota:_ el `SELECT` del último evento que hace el trigger corre bajo RLS, porque la función es
`SECURITY INVOKER`. No es un problema: filtra por `NEW.site_id`, y ese sitio está dentro del
alcance de la sesión o el `WITH CHECK` ya habría rechazado el `INSERT`.

### `audit_log.site_id` sin clave foránea

La tabla `site` es de dominio y llega en la etapa 2. Se declara `uuid NOT NULL` sin FK y se
agrega la referencia en la migración que cree `site`. La alternativa —crear `site` ahora— viola
el alcance del change y adelanta decisiones de la etapa 2.

### Suite de integración aparte, con el `01-roles.sql` real

`apps/api/vitest.config.mts` incluye solo `src/**/*.spec.ts` y no debe empezar a levantar
contenedores: los tests de funciones puras que describe ADR-008 corren en milisegundos y esa
propiedad se pierde si comparten config. Va un `vitest.integration.config.mts` con
`test/**/*.int-spec.ts`, `testTimeout` largo y script `test:int`.

El contenedor de Testcontainers monta **el mismo `db/init/01-roles.sql`** que usa
`docker-compose.yml`. Un test contra roles definidos aparte probaría roles que no existen en
ningún lado.

## Risks / Trade-offs

| Riesgo | Mitigación |
| --- | --- |
| Alguien corre `drizzle-kit generate` y la migración regenerada pierde `REVOKE`, triggers y políticas. | Comentario prohibitivo en `drizzle.config.ts`, sin script de `generate` en `package.json`, y los tests de integración fallan de inmediato si el mecanismo desaparece. |
| Una migración futura crea una tabla inmutable y olvida llamar a los helpers. La tabla queda mutable sin ningún error. | Es el riesgo residual real. Se acota con un test de integración que recorre `pg_class` y verifica que toda tabla con columna `site_id` tenga RLS forzado y trigger de inmutabilidad — se agrega cuando exista la segunda tabla, no acá con una sola. |
| El lock por sitio serializa los INSERT de auditoría de un mismo sitio. | 24 inspecciones al año por sitio y ~15 usuarios. La contención es teórica; ADR-002 ya acepta este orden de costo. |
| La cadena no defiende contra un atacante con superusuario que la recalcule entera. | Declarado como Non-Goal. ADR-008 cubre el flanco con PITR y versioning del bucket. |
| Testcontainers necesita Docker en CI y agrega minutos al pipeline. | El runner de GitHub ya trae Docker. Va como job separado del de lint/build para que un fallo de integración se distinga de un fallo de compilación. |

## Migration Plan

1. `0001_immutability_mechanism.sql` — funciones y helpers. No crea tablas: aplicarla sobre una
   base con datos es inocua.
2. `0002_audit_log.sql` — tabla `audit_log`, trigger de cadena, `hs_make_immutable` y
   `hs_apply_site_isolation`.

Ambas corren como `hs_migrator` con `MIGRATION_DATABASE_URL`.

**Rollback:** el proyecto no tiene datos reales todavía, así que el rollback es `pnpm db:reset`.
No se escriben migraciones `down`: una vez que haya datos de producción, revertir una tabla
inmutable es restaurar desde PITR, no ejecutar un `DROP`.
