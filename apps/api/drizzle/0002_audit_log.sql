-- ADR-002 / ADR-008 — El LogDeAuditoría: append-only y encadenado por sitio.
--
-- Es la única tabla que crea la etapa 0, y no es una tabla de dominio: el log es
-- parte del mecanismo. Las tablas de dominio llegan en las etapas 1 y 2.

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Sin FK a propósito: la tabla `site` es de dominio y llega en la etapa 2. La
  -- referencia la agrega `0004_site_location_catalog.sql`, que es donde nace
  -- `site`. Esta migración ya está aplicada y no se toca.
  site_id uuid NOT NULL,

  -- Posición dentro de la cadena del sitio. La asigna el trigger; lo que mande el
  -- caller se descarta.
  seq bigint NOT NULL,

  -- Nullable: hay eventos del sistema que no tienen un usuario detrás.
  --
  -- Sin FK acá por orden de construcción: `app_user` es de dominio y llega en la
  -- etapa 2. La referencia la agrega `0005_identity.sql`, que es donde nace la
  -- tabla de cuentas. Esta migración ya está aplicada y no se toca.
  actor_user_id uuid,

  event_type text NOT NULL,
  payload jsonb NOT NULL,

  -- Riesgo C de requisitos §5: doble timestamp. `occurred_at` lo manda el
  -- dispositivo y puede ser de días atrás si la captura fue offline;
  -- `recorded_at` lo pone el servidor y es lo único que ordena el log.
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,

  prev_hash bytea,
  hash bytea NOT NULL
);

--> statement-breakpoint

-- Único porque la cadena de un sitio no puede tener dos eslabones en la misma
-- posición: es la red que atrapa un fallo del lock antes que lo haga la
-- verificación.
CREATE UNIQUE INDEX audit_log_site_seq_uq ON audit_log (site_id, seq);

--> statement-breakpoint

-- La lectura real del log es "qué pasó en este sitio, en orden de servidor".
CREATE INDEX audit_log_site_recorded_at_idx ON audit_log (site_id, recorded_at);

--> statement-breakpoint

-- Serialización canónica de una fila. La usan el trigger que calcula el hash y el
-- verificador: si divergen, la verificación miente.
--
-- Se construye como jsonb y se castea a texto porque jsonb ya normaliza orden de
-- claves, espacios y duplicados, y escapa el contenido — dos campos distintos no
-- pueden producir la misma cadena por casualidad.
--
-- Los timestamptz NUNCA se castean a texto directo: el texto de un timestamptz
-- depende de los GUC `TimeZone` y `DateStyle` de la sesión, así que la misma fila
-- hashearía distinto según quién la lea y la verificación fallaría sin que nadie
-- haya tocado nada.
CREATE OR REPLACE FUNCTION hs_audit_canonical(entry audit_log)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'site_id', entry.site_id,
    'seq', entry.seq,
    'actor_user_id', entry.actor_user_id,
    'event_type', entry.event_type,
    'payload', entry.payload,
    'occurred_at', to_char(entry.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    'recorded_at', to_char(entry.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
  )::text;
$fn$;

--> statement-breakpoint

-- La cadena se calcula acá y no en Node: si la aplicación calcula el hash, quien
-- controla la aplicación controla la cadena y la garantía se evapora.
--
-- El lock es por sitio y no global: dos sitios escriben en paralelo sin
-- bloquearse, y la verificación ante el MLITSD se pide por sitio. El costo es que
-- no hay un orden total único del log; el orden global sigue disponible por
-- `recorded_at`.
--
-- El SELECT corre bajo RLS porque la función es SECURITY INVOKER. No es un
-- problema: filtra por NEW.site_id, y ese sitio está dentro del alcance de la
-- sesión o el WITH CHECK de la política ya habría rechazado el INSERT.
CREATE OR REPLACE FUNCTION hs_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  last_seq bigint;
  last_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.site_id::text, 0));

  SELECT a.seq, a.hash
    INTO last_seq, last_hash
    FROM audit_log a
   WHERE a.site_id = NEW.site_id
   ORDER BY a.seq DESC
   LIMIT 1;

  -- Los cuatro campos se sobrescriben siempre: lo que haya mandado el caller es
  -- irrelevante por definición.
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.recorded_at := now();

  -- sha256(bytea) es nativo en Postgres 17: no hace falta pgcrypto.
  NEW.hash := sha256(
    coalesce(NEW.prev_hash, ''::bytea) || convert_to(hs_audit_canonical(NEW), 'UTF8'));

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION hs_audit_chain();

--> statement-breakpoint

-- Recorre la cadena de un sitio y devuelve el primer eslabón roto, o ninguna fila
-- si está intacta. Devuelve el primero y corta: a partir de ahí todo lo que sigue
-- está roto por arrastre y enumerarlo no agrega información.
--
-- Corre bajo RLS: la sesión tiene que declarar el sitio en su alcance.
CREATE OR REPLACE FUNCTION hs_audit_verify_chain(target_site uuid)
RETURNS TABLE (broken_id bigint, broken_seq bigint, reason text)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  entry audit_log;
  expected_prev bytea := NULL;
BEGIN
  FOR entry IN
    SELECT * FROM audit_log a WHERE a.site_id = target_site ORDER BY a.seq
  LOOP
    IF entry.prev_hash IS DISTINCT FROM expected_prev THEN
      broken_id := entry.id;
      broken_seq := entry.seq;
      reason := 'prev_hash does not match the hash of the preceding entry';
      RETURN NEXT;
      RETURN;
    END IF;

    IF entry.hash IS DISTINCT FROM sha256(
      coalesce(entry.prev_hash, ''::bytea) || convert_to(hs_audit_canonical(entry), 'UTF8'))
    THEN
      broken_id := entry.id;
      broken_seq := entry.seq;
      reason := 'hash does not match the stored contents of the entry';
      RETURN NEXT;
      RETURN;
    END IF;

    expected_prev := entry.hash;
  END LOOP;

  RETURN;
END;
$fn$;

--> statement-breakpoint

SELECT hs_make_immutable('audit_log');

--> statement-breakpoint

SELECT hs_apply_site_isolation('audit_log');
