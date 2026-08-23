-- Requisitos §7 — El alcance declarado en la auditoría de la planta.
--
-- Endurece `hs_site_audit` sin conceder ni revocar nada: no hay GRANT, no hay
-- REVOKE, no hay política, y no se toca ninguna tabla. Dos cambios sobre la
-- versión vigente (`0026_reactivate_site.sql`, que la reemplazó para agregar la
-- rama de reactivación):
--
--   1. EL ALTA ENSANCHA EL ALCANCE, NO LO PISA. `set_config` escribía el valor
--      entero, así que `002_sites.sql` —dos plantas en una sentencia— terminaba
--      con la segunda tapando la declaración de la primera. Cada entrada se
--      escribía igual, porque cada una va después de su propio `set_config`; lo
--      que quedaba mal era el alcance de la transacción a partir de ahí. Hoy no
--      muerde porque el seed corre un archivo por transacción y cada archivo
--      posterior declara el suyo, y eso es exactamente lo que lo hace una trampa.
--
--   2. RENOMBRAR, DAR DE BAJA Y REACTIVAR EXIGEN QUE LA PLANTA ESTÉ DECLARADA, y
--      lo dicen. Sin esto el rechazo llega como una violación de RLS sobre
--      `audit_log`: no nombra `site`, no nombra la planta y no dice que falta
--      declararla. Falla lejos de la causa, que es la forma de fallar que este
--      proyecto trata como riesgo.
--
-- LA ASIMETRÍA ES LA DECISIÓN, no el defecto que se arregla. El alta se declara
-- sola porque una planta que se está creando no puede estar en el alcance de
-- nadie —y porque un seed tiene que poder registrarla igual—. Un UPDATE es el
-- caso contrario: la planta ya existe y la transacción no la reclamó, que es
-- justamente lo que el aislamiento existe para atrapar. Declararse sola ahí
-- dejaría que cualquiera se ensanche el alcance como efecto de un UPDATE, y como
-- `set_config(..., true)` es SET LOCAL, el ensanche sobreviviría a la sentencia y
-- cambiaría en silencio lo que ve el resto de la transacción.
--
-- NO SE RECREA EL TRIGGER, y no es un olvido: `site_audit` ya apunta a esta
-- función y `CREATE OR REPLACE` alcanza. `0023` y `0026` lo recrean porque
-- llegaron con el trigger recién nacido o con un DROP previo.
CREATE OR REPLACE FUNCTION hs_site_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Los seeds no tienen alcance declarado. Se AGREGA la planta recién insertada
    -- al alcance que la transacción ya tuviera, para que su entrada pueda entrar
    -- en la cadena protegida sin costarle a la transacción una declaración que ya
    -- tenía. `hs_declared_sites()` (0005) devuelve el arreglo, así que agregar es
    -- una operación sobre uuid[] y no sobre la cadena.
    --
    -- El `IF` lo deja idempotente: el servicio ya declara su alcance más este id
    -- antes del INSERT (`sites.service.ts`), y ahí esto no hace nada.
    IF NOT (NEW.id = ANY (hs_declared_sites())) THEN
      PERFORM set_config(
        'app.site_ids',
        array_to_string(hs_declared_sites() || NEW.id, ','),
        true);
    END IF;

    INSERT INTO audit_log (
      site_id, seq, actor_user_id, event_type, payload, occurred_at, recorded_at, prev_hash, hash
    )
    VALUES (
      NEW.id, 0, actor, 'site.created',
      jsonb_build_object('site_id', NEW.id, 'code', NEW.code, 'name', NEW.name),
      now(), now(), NULL, ''::bytea
    );

    RETURN NULL;
  END IF;

  -- Antes de intentar la primera entrada, para que el rechazo no deje nada a
  -- medias y para que el mensaje sea el primero que se lee.
  IF NOT (NEW.id = ANY (hs_declared_sites())) THEN
    RAISE EXCEPTION
      'site % is not in the declared site scope of this transaction', NEW.id
      USING ERRCODE = 'HS013',
            HINT = 'Declare it with SET LOCAL app.site_ids before renaming, deactivating or reactivating a site.';
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.id, actor, 'site.renamed',
      jsonb_build_object(
        'site_id', NEW.id,
        'code', NEW.code,
        'previous_name', OLD.name,
        'name', NEW.name),
      now(), now(), ''::bytea
    );
  END IF;

  IF OLD.deactivated_at IS NULL AND NEW.deactivated_at IS NOT NULL THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.id, actor, 'site.deactivated',
      jsonb_build_object(
        'site_id', NEW.id,
        'code', NEW.code,
        'name', NEW.name,
        'deactivated_at', NEW.deactivated_at),
      now(), now(), ''::bytea
    );
  END IF;

  IF OLD.deactivated_at IS NOT NULL AND NEW.deactivated_at IS NULL THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.id, actor, 'site.reactivated',
      jsonb_build_object(
        'site_id', NEW.id,
        'code', NEW.code,
        'name', NEW.name),
      now(), now(), ''::bytea
    );
  END IF;

  RETURN NULL;
END;
$fn$;
