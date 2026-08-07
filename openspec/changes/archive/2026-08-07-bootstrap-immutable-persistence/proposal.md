# Bootstrap de la persistencia inmutable

## Why

ADR-002 es categórico: si la inmutabilidad vive en el código de la aplicación, no existe. Hoy
el repo tiene los dos roles de Postgres creados (`db/init/01-roles.sql`) pero ni una sola
migración, así que "un `UPDATE` con el rol de la app falla en el motor" sigue siendo una nota
en un ADR y no un hecho verificado.

Es la etapa 0 de `docs/Requisitos_V1.2.md` §7 y cierra el **spike 2**. Va primero porque todas
las etapas siguientes escriben migraciones: si la primera tabla de dominio se escribe antes de
que exista el mecanismo, se escribe asumiendo permisos que el rol real nunca va a tener, y
desandarlo después es caro.

## What Changes

- Migraciones SQL versionadas y escritas a mano, aplicadas con `drizzle-kit` bajo el rol
  `hs_migrator`. `drizzle-kit generate` queda prohibido: una migración autogenerada no incluye
  `REVOKE`, triggers ni políticas RLS.
- Helpers de esquema que convierten la inmutabilidad en un solo llamado por tabla:
  `hs_make_immutable()` (trigger `BEFORE UPDATE OR DELETE` + `REVOKE UPDATE, DELETE` a `hs_app`)
  y `hs_apply_site_isolation()` (`ENABLE` + `FORCE ROW LEVEL SECURITY` + política por sitio).
- Tabla `audit_log`: append-only, con cadena de hashes SHA-256 **por sitio**, calculada en un
  trigger `BEFORE INSERT` para que la aplicación no pueda forjar un eslabón.
- Doble timestamp en el log (`occurred_at` del dispositivo, `recorded_at` del servidor), según
  el riesgo C de §5.
- Conexión de `apps/api` con contexto RLS por transacción: `SET LOCAL app.site_ids` y
  `app.user_id`, nunca un `WHERE` por sitio en el endpoint.
- Suite de integración con Testcontainers, levantando el **mismo** `db/init/01-roles.sql` que
  usa `docker-compose.yml`, más un job nuevo en `.github/workflows/ci.yml`.

Fuera de alcance, explícito: **ninguna tabla de dominio**. Ni `site`, ni `person`, ni
`inspection`, ni `template`. Este change establece el mecanismo; el esquema llega en las etapas
1 y 2. `audit_log` es la única tabla que se crea, porque el `LogDeAuditoría` es parte del
mecanismo y no de un dominio en particular — y porque da un sujeto real sobre el cual probar la
inmutabilidad, en lugar de una tabla de juguete que después habría que borrar.

Por la misma razón, `audit_log.site_id` es un `uuid` **sin clave foránea**: la tabla `site` no
existe todavía. La FK se agrega en la etapa 2.

## Capabilities

### New Capabilities

- `immutability`: el mecanismo de inmutabilidad forzada por el motor — privilegios revocados al
  rol de aplicación, triggers como segunda barrera, separación del rol de migraciones y
  aislamiento por sitio vía RLS.
- `audit`: el `LogDeAuditoría` append-only, su cadena de hashes SHA-256 por sitio y la
  verificación de integridad de esa cadena.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío: este es el primer change del proyecto.

## Impact

| Área | Efecto |
| --- | --- |
| `apps/api` | Dependencias nuevas: `drizzle-orm`, `drizzle-kit`, `pg`. Carpeta de migraciones, módulo de base de datos y suite de integración. |
| `db/init/01-roles.sql` | Sin cambios, pero pasa a estar bajo prueba: el contenedor de test lo monta tal cual. |
| `.github/workflows/ci.yml` | Job nuevo que corre los tests de integración con Docker. |
| `.env.example` | Ya declara `DATABASE_URL` y `MIGRATION_DATABASE_URL`; este change los pone en uso. |
| Todos los changes futuros | Quedan obligados a llamar a los helpers en cada migración que cree una tabla inmutable o con datos por sitio. |
