-- Requisitos §6 pregunta cerrada 1 — El catálogo de sitios y ubicaciones.
--
-- "La ubicación del hallazgo es una lista cerrada administrada por el
-- coordinador, no texto libre." Lista cerrada no es una regla de formulario: un
-- desplegable que igual acepta cualquier `location_id`, o un endpoint que confía
-- en el `site_id` del payload, deja la lista abierta por la puerta de atrás y no
-- produce ningún error. Todo lo que se puede mover al motor está acá.
--
-- Es además la primera tabla del proyecto con `hs_apply_site_isolation`: el
-- aislamiento por sitio de §6 pregunta 5 deja de ser un mecanismo escrito y pasa
-- a ser un mecanismo aplicado.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que 0001 y 0003:
--   HS001  append-only / columna de identidad no modificable (reusado de 0001)

-- ---------------------------------------------------------------------------
-- 1. `site` — las dos plantas.
--
-- Dato de referencia de la organización, no contenido operativo: la fila dice que
-- la planta existe, nada más. Por eso NO lleva política RLS.
--
-- Ponérsela crearía un arranque circular —para insertar la fila habría que
-- declarar en `app.site_ids` un id que todavía no existe— a cambio de esconder el
-- hecho de que la otra planta existe, que no es lo que protege §6 pregunta 5. Lo
-- que esa pregunta protege son los hallazgos, y viven en tablas con `site_id` y
-- con política. El aislamiento empieza en `location`.
CREATE TABLE site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La identidad. Estable e inmutable: es lo que usan los seeds, los fixtures y
  -- los tests para nombrar un sitio sin conocer su id.
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),

  -- La etiqueta que ve el operador. Editable.
  name text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nunca DELETE. Un sitio cerrado sigue siendo el sitio de todo su historial.
  deactivated_at timestamptz
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `location` — el catálogo cerrado, por sitio.
--
-- Un solo nivel a propósito (fuera de alcance: jerarquías, mapas, QR). Si "Línea
-- de empaque 3" necesita partirse en estaciones, son entradas nuevas con su
-- propio `code`, no un árbol: un árbol convierte "dónde pasó" en una pregunta con
-- varias respuestas correctas, y la recurrencia de la etapa 7 vuelve a no poder
-- agrupar.
CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- Misma división que la identidad dual del ítem (0003), un nivel más abajo:
  -- `code` es la identidad y no cambia nunca; `name` es la etiqueta y el
  -- coordinador la corrige cuando quiere.
  code text NOT NULL CHECK (code ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  name text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- La baja lógica. Una ubicación desactivada desaparece del desplegable y sigue
  -- resolviendo desde los hallazgos históricos: la inspección de hace dos años
  -- sigue diciendo dónde se hizo.
  deactivated_at timestamptz,

  -- Los dos sitios son espacios de nombres independientes: `shipping-dock` puede
  -- existir en los dos.
  CONSTRAINT location_site_code_uq UNIQUE (site_id, code),

  -- Redundante como restricción —`id` ya es PK— y necesario igual: Postgres exige
  -- un único sobre las columnas exactas para poder ser destino de una FK
  -- compuesta. Es lo que va a permitir que toda tabla con ubicación declare
  --
  --   FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)
  --
  -- y que una inspección de St. Thomas con una ubicación de Glencoe sea un error
  -- de FK y no un bug de validación. El RLS NO alcanza para atrapar eso: el
  -- coordinador tiene las dos plantas en su alcance, así que para él las dos filas
  -- son visibles y la política no dice nada.
  CONSTRAINT location_site_id_uq UNIQUE (site_id, id)
);

--> statement-breakpoint

-- Único PARCIAL, solo sobre las activas. Con un único total, un nombre dado de
-- baja hace tres años quedaría quemado para siempre y reactivar chocaría contra
-- una fila que ya nadie usa. Lo que hay que proteger es el desplegable, que es
-- donde el duplicado hace daño: dos entradas idénticas y el operador eligiendo al
-- azar.
CREATE UNIQUE INDEX location_site_active_name_uq
  ON location (site_id, name)
  WHERE deactivated_at IS NULL;

--> statement-breakpoint

-- La lectura real es "las ubicaciones activas de este sitio, en orden alfabético":
-- es exactamente el desplegable.
CREATE INDEX location_site_active_idx
  ON location (site_id, name)
  WHERE deactivated_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Mutabilidad parcial, con las dos barreras.
--
-- Ni `site` ni `location` pueden ser inmutables: renombrar y dar de baja son
-- UPDATE. Llevan entonces el patrón de `template_item` (0003 §7): el GRANT por
-- columna frena a hs_app con 42501, y este trigger frena a CUALQUIER rol —
-- hs_migrator incluido, que es dueño y por lo tanto siempre podría— con HS001.
--
-- Sin la segunda barrera, "parcialmente mutable" quiere decir, en la práctica,
-- "entera".
CREATE OR REPLACE FUNCTION hs_catalog_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  offending text;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    offending := 'id';
  ELSIF NEW.code IS DISTINCT FROM OLD.code THEN
    offending := 'code';
  ELSIF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    offending := 'created_at';
  ELSIF TG_TABLE_NAME = 'location'
        AND to_jsonb(NEW) ->> 'site_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'site_id' THEN
    -- `site` no tiene la columna, así que el acceso directo no compila para las
    -- dos tablas: se resuelve por jsonb, que es lo único que sirve para un
    -- trigger compartido.
    offending := 'site_id';
  END IF;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      '% is mutable only in name and deactivated_at: changing % is not allowed',
      TG_TABLE_NAME, offending
      USING ERRCODE = 'HS001',
            HINT = 'The identity of a catalogue entry is assigned once; deactivate and register a new one instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER site_guard
  BEFORE UPDATE ON site
  FOR EACH ROW EXECUTE FUNCTION hs_catalog_guard();

--> statement-breakpoint

CREATE TRIGGER location_guard
  BEFORE UPDATE ON location
  FOR EACH ROW EXECUTE FUNCTION hs_catalog_guard();

--> statement-breakpoint

-- La baja es lógica, y esto es lo que hace que sea lo ÚNICO que la tabla admite:
-- sin DELETE no hay forma de que una inspección histórica pierda su ubicación. Se
-- reusa `hs_forbid_mutation()` de 0001 en lugar de escribir otro — es el mismo
-- hecho.
CREATE TRIGGER site_forbid_deletion
  BEFORE DELETE ON site
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER site_forbid_truncate
  BEFORE TRUNCATE ON site
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER location_forbid_deletion
  BEFORE DELETE ON location
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER location_forbid_truncate
  BEFORE TRUNCATE ON location
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Auditoría del catálogo, escrita por el motor.
--
-- Administrar el catálogo es una operación consecuente: cambia lo que las
-- inspecciones futuras van a poder decir sobre dónde pasó algo. Si la auditoría
-- viviera en el servicio, el hueco aparecería la primera vez que exista una
-- segunda ruta de escritura —un script, un seed, una corrección a mano— y el
-- hueco es invisible: la operación funciona, simplemente no queda registrada.
--
-- El actor sale del alcance de la transacción (`app.user_id`, que ya fija
-- `withSiteScope`), no de un parámetro: el servicio no tiene nada que recordar.
-- Nulo durante seeds y migraciones, que es lo correcto — no hay usuario detrás.
--
-- El INSERT corre bajo la política RLS de `audit_log` porque la función es
-- SECURITY INVOKER. No es un problema, por el mismo motivo que documenta 0002: si
-- la transacción pudo escribir la fila de `location` de ese sitio, ese sitio está
-- en su alcance.
CREATE OR REPLACE FUNCTION hs_catalog_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.site_id, actor, 'location.created',
      jsonb_build_object(
        'location_id', NEW.id,
        'code', NEW.code,
        'name', NEW.name),
      now(), now(), ''::bytea);

    RETURN NULL;
  END IF;

  -- Un UPDATE puede cambiar las dos cosas observables a la vez. Se escribe una
  -- entrada por cambio y no una entrada mezclada: "renombrar" y "dar de baja" son
  -- dos hechos distintos y el reporte los lee por separado.
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.site_id, actor, 'location.renamed',
      jsonb_build_object(
        'location_id', NEW.id,
        'code', NEW.code,
        'previous_name', OLD.name,
        'name', NEW.name),
      now(), now(), ''::bytea);
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.site_id, actor,
      CASE WHEN NEW.deactivated_at IS NULL THEN 'location.reactivated' ELSE 'location.deactivated' END,
      jsonb_build_object(
        'location_id', NEW.id,
        'code', NEW.code,
        'name', NEW.name,
        'deactivated_at', NEW.deactivated_at),
      now(), now(), ''::bytea);
  END IF;

  -- Un UPDATE que no cambia nada observable no escribe nada: el log registra
  -- hechos, no sentencias.
  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- `seq`, `prev_hash`, `recorded_at` y `hash` los sobrescribe el trigger de la
-- cadena de 0002: los valores de arriba son de relleno para satisfacer el NOT
-- NULL, exactamente igual que los que manda la API.
CREATE TRIGGER location_audit
  AFTER INSERT OR UPDATE ON location
  FOR EACH ROW EXECUTE FUNCTION hs_catalog_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Aislamiento por sitio.
--
-- Primer consumidor real de `hs_apply_site_isolation`. Instala la política sobre
-- `site_id` y hace FORCE ROW LEVEL SECURITY, así que hs_migrator —dueño de la
-- tabla— TAMPOCO la evade: los seeds de ubicaciones declaran `app.site_ids` como
-- cualquier otra transacción. Ver `apps/api/seeds/003_locations.sql`.
--
-- Consecuencia buscada: una transacción que no declara alcance no ve ninguna
-- ubicación y no falla. Es el default correcto (ver `src/db/site-scope.ts`), y la
-- forma de fallar —"el catálogo se ve vacío"— está cubierta por un test para que
-- nadie la descubra en una pantalla.
SELECT hs_apply_site_isolation('location');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` conceden SELECT e INSERT sobre
-- toda tabla nueva.
--
-- `site` se siembra: la API solo lee. Las dos plantas no son un dato que se cree
-- desde una pantalla.
REVOKE INSERT ON site FROM hs_app;

--> statement-breakpoint

-- `location` sí la administra el coordinador desde la aplicación: INSERT para dar
-- de alta, y UPDATE ACOTADO POR COLUMNA para renombrar y dar de baja. Cualquier
-- otra columna la frena el motor con 42501 sin que el trigger llegue a correr.
--
-- Que sea *el coordinador* y no cualquier usuario autenticado necesita dos cosas:
-- el rol, que ya existe desde `0005_identity.sql`, y un endpoint que lo exija, que
-- todavía no. Mientras no exista ningún endpoint de catálogo, la superficie es cero.
GRANT UPDATE (name, deactivated_at) ON location TO hs_app;

--> statement-breakpoint

-- DELETE no se concede nunca, sobre ninguna de las dos.
GRANT SELECT ON site, location TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. La FK que 0002 dejó anotada.
--
-- `audit_log.site_id` era un uuid sin FK por orden de construcción: la tabla
-- `site` no existía. Ya existe. Una entrada que nadie puede atribuir a un lugar de
-- trabajo no sostiene el registro regulatorio para el que el log existe.
--
-- ADD CONSTRAINT sobre una tabla inmutable es legal: `hs_make_immutable` bloquea
-- UPDATE, DELETE y TRUNCATE de filas, no DDL del dueño. Y la FK no entra en
-- `hs_audit_canonical`, así que ningún hash cambia y la verificación de la cadena
-- da lo mismo antes y después de esta migración.
--
-- NO ACTION explícito: `site` no se borra, y si alguien lo intentara, la FK tiene
-- que frenarlo. Una cascada acá se llevaría puesto justo lo que hay que conservar.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES site (id) ON DELETE NO ACTION;
