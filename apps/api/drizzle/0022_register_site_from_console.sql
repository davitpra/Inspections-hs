-- Requisitos §7 — Alta de una planta desde la consola de ubicaciones.
--
-- 0004 §6 decidió que `site` se sembraba y que la API solo leía: las dos plantas
-- iniciales eran dato de referencia asentado antes de la aplicación. Esa decisión
-- ya no alcanza para una tercera planta, así que se corrige de forma estrecha:
-- hs_app recibe INSERT y NO recibe UPDATE ni DELETE.
--
-- `site` sigue SIN política RLS. Declararla volvería circular el alta: habría que
-- declarar en `app.site_ids` un id que todavía no existe. `site_guard`,
-- `site_forbid_deletion` y `site_forbid_truncate` quedan intactos.

GRANT INSERT ON site TO hs_app;

--> statement-breakpoint

-- La auditoría vive en el motor para cubrir también seeds y cualquier otra vía de
-- escritura. `seq`, `prev_hash` y `hash` son relleno: el trigger de la cadena de
-- 0002 los sobrescribe antes de almacenar la entrada.
CREATE OR REPLACE FUNCTION hs_site_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  -- Los seeds insertan `site` sin sesión. Declarar solo el id recién creado permite
  -- que su entrada llegue a la cadena RLS-protegida sin ampliar un alcance HTTP.
  -- El servicio ya declara el alcance original más este mismo id antes del INSERT.
  IF NOT (NEW.id = ANY (hs_declared_sites())) THEN
    PERFORM set_config('app.site_ids', NEW.id::text, true);
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
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER site_audit
  AFTER INSERT ON site
  FOR EACH ROW EXECUTE FUNCTION hs_site_audit();
