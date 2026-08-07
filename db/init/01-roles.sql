-- ADR-002 — Inmutabilidad forzada por el motor, no por código de aplicación.
--
-- Dos roles desde el arranque del contenedor, no después:
--
--   hs_migrator  dueño de la base y del schema. Crea tablas, triggers, políticas
--                RLS y los GRANT/REVOKE. Es el único que puede cambiar el esquema.
--   hs_app       runtime de apps/api. Sin CREATE. Por default privileges solo
--                recibe SELECT e INSERT: UPDATE y DELETE hay que concederlos
--                tabla por tabla, en la migración, y de forma explícita.
--
-- El spike 2 (etapa 0 de requisitos-v1.2 §7) es exactamente esto: un UPDATE con
-- el rol de la app tiene que fallar en el motor. Si el proyecto arrancara
-- conectándose como superusuario, la primera migración se escribiría asumiendo
-- permisos que el rol real nunca va a tener, y desandarlo después es caro.
--
-- Las contraseñas de este archivo son de desarrollo local. En los entornos
-- gestionados los roles se crean con el mismo script y credenciales de secreto.

\set ON_ERROR_STOP on

CREATE ROLE hs_migrator LOGIN PASSWORD 'hs_migrator_dev'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE ROLE hs_app LOGIN PASSWORD 'hs_app_dev'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- PUBLIC es un rol al que pertenece todo el mundo. Si no se le revoca primero,
-- le regala a hs_app justo lo que el resto del script intenta no darle.
REVOKE ALL ON DATABASE hs_platform FROM PUBLIC;

ALTER DATABASE hs_platform OWNER TO hs_migrator;
GRANT CONNECT ON DATABASE hs_platform TO hs_migrator, hs_app;

ALTER SCHEMA public OWNER TO hs_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO hs_migrator;
GRANT USAGE ON SCHEMA public TO hs_app;

-- Default privileges sobre lo que cree hs_migrator de acá en adelante.
-- Sin UPDATE ni DELETE: la inmutabilidad es el default, no la excepción.
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO hs_app;

-- Sin esto, los INSERT sobre columnas identity/serial fallan con un error que no
-- menciona secuencias en ningún lado.
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hs_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO hs_app;

-- Nota para las migraciones de ADR-004: hs_migrator es dueño de las tablas y el
-- dueño de una tabla evade RLS. Toda tabla con políticas por sitio necesita
-- ALTER TABLE ... FORCE ROW LEVEL SECURITY, o el aislamiento no aplica al rol
-- que corre las migraciones.
