-- Requisitos §7 — Reactivación de plantas desde la consola de ubicaciones.
--
-- Esta migración no lleva GRANT, REVOKE ni política RLS. `0023` ya concedió
-- UPDATE (name, deactivated_at) sobre `site`; DELETE sigue revocado por
-- `site_forbid_deletion`, y `site` sigue sin RLS por la circularidad documentada
-- en `0004`. Lo que faltaba era registrar la transición inversa, no conceder un
-- privilegio nuevo.

-- La auditoría de la planta vive en el motor para cubrir la API, seeds y cualquier
-- otra vía de escritura. La cadena de 0002 completa seq, prev_hash y hash.
CREATE OR REPLACE FUNCTION hs_site_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Los seeds no tienen alcance declarado. El trigger declara solo la planta recién
    -- insertada para que su entrada pueda entrar en la cadena protegida.
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

--> statement-breakpoint

DROP TRIGGER IF EXISTS site_audit ON site;

CREATE TRIGGER site_audit
  AFTER INSERT OR UPDATE ON site
  FOR EACH ROW EXECUTE FUNCTION hs_site_audit();
