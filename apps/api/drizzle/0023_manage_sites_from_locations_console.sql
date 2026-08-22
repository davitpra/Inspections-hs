-- Requisitos §7 — Gestión de plantas desde la consola de ubicaciones.
--
-- `site` ya tiene la guardia de mutabilidad parcial de 0004: code, id y created_at
-- siguen siendo identidad. Se concede únicamente la actualización de la etiqueta y
-- la baja lógica; DELETE y TRUNCATE continúan prohibidos.
--
-- `site` sigue SIN política RLS por la circularidad documentada en 0004. `location`
-- sí conserva FORCE RLS por site_id: el unlink de una planta solo puede alcanzar las
-- físicas que la sesión ya tiene declaradas.

REVOKE UPDATE ON site FROM hs_app;
GRANT UPDATE (name, deactivated_at) ON site TO hs_app;

--> statement-breakpoint

-- La auditoría de la planta vive en el motor para que cubra la API, seeds y cualquier
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

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

DROP TRIGGER IF EXISTS site_audit ON site;

CREATE TRIGGER site_audit
  AFTER INSERT OR UPDATE ON site
  FOR EACH ROW EXECUTE FUNCTION hs_site_audit();

--> statement-breakpoint

-- La baja de una planta deshace el vínculo de cada ubicación física, pero no borra
-- la fila física ni la compartida. Solo la transición no nulo -> NULL es un unlink;
-- mapear una ubicación nueva no es parte de esta auditoría.
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

  IF OLD.organization_location_id IS NOT NULL AND NEW.organization_location_id IS NULL THEN
    INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
    VALUES (
      NEW.site_id, actor, 'location.unlinked',
      jsonb_build_object(
        'location_id', NEW.id,
        'code', NEW.code,
        'previous_organization_location_id', OLD.organization_location_id),
      now(), now(), ''::bytea);
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

DROP TRIGGER IF EXISTS location_audit ON location;

CREATE TRIGGER location_audit
  AFTER INSERT OR UPDATE ON location
  FOR EACH ROW EXECUTE FUNCTION hs_catalog_audit();
