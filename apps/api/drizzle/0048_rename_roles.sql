-- ADR-024 — Renombre preproducción de `hs_coordinator`/`jhsc_member`.
--
-- Convierte las cuentas existentes en sitio y conserva sus credenciales, sesiones, alcance
-- e historia. El UPDATE dispara `hs_account_changed_audit()` y deja `previous_role` con el
-- identificador histórico. No se escribe ninguna fila de `corrective_action_escalation`:
-- la tabla es inmutable; solo se amplía su CHECK para conservar niveles históricos.
--
-- Esta migración no concede ni revoca privilegios y no cambia FORCE RLS. Los GRANT vigentes
-- de 0047, incluido UPDATE (email, role, deactivated_at) sobre `app_user`, permanecen.
-- Escrita a mano; `drizzle-kit generate` está prohibido.

ALTER TABLE app_user DROP CONSTRAINT app_user_role_check;

--> statement-breakpoint

DO $rename$
BEGIN
  PERFORM set_config(
    'app.site_ids',
    COALESCE((SELECT string_agg(id::text, ',' ORDER BY id) FROM site), ''),
    true
  );

  UPDATE app_user
     SET role = CASE role
       WHEN 'hs_coordinator' THEN 'coordinator'
       WHEN 'jhsc_member' THEN 'inspector'
       ELSE role
     END
   WHERE role IN ('hs_coordinator', 'jhsc_member');
END;
$rename$;

--> statement-breakpoint

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_user
     WHERE role NOT IN ('coordinator', 'inspector', 'management')
  ) THEN
    RAISE EXCEPTION 'cannot rename roles while an app_user carries an unknown role';
  END IF;
END;
$guard$;

--> statement-breakpoint

ALTER TABLE app_user ADD CONSTRAINT app_user_role_check
  CHECK (role IN ('coordinator', 'inspector', 'management'));

--> statement-breakpoint

DROP POLICY incident_visibility ON incident;

--> statement-breakpoint

CREATE POLICY incident_visibility ON incident
  AS RESTRICTIVE
  FOR ALL
  USING (
    reported_by = nullif(current_setting('app.user_id', true), '')::uuid
    OR nullif(current_setting('app.role', true), '') IN ('coordinator', 'management'))
  WITH CHECK (
    reported_by = nullif(current_setting('app.user_id', true), '')::uuid
    AND nullif(current_setting('app.role', true), '') IN ('coordinator', 'management'));

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_action_verifier_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  executor uuid;
  actor_role text;
BEGIN
  IF NEW.from_state IS DISTINCT FROM 'awaiting_verification' THEN
    RETURN NEW;
  END IF;

  SELECT e.actor_user_id INTO executor
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
     AND e.to_state = 'awaiting_verification'
   ORDER BY e.position DESC
   LIMIT 1;

  IF executor IS DISTINCT FROM NEW.actor_user_id THEN
    RETURN NEW;
  END IF;

  SELECT u.role INTO actor_role
    FROM app_user u
   WHERE u.id = NEW.actor_user_id;

  IF actor_role = 'coordinator' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'user % declared action % done and cannot verify it', NEW.actor_user_id, NEW.action_id
    USING ERRCODE = 'HS005',
          HINT = 'A corrective action is verified by someone other than whoever did the work, unless they are the coordinator.';

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

ALTER TABLE corrective_action_escalation
  DROP CONSTRAINT corrective_action_escalation_level_check;

--> statement-breakpoint

ALTER TABLE corrective_action_escalation
  ADD CONSTRAINT corrective_action_escalation_level_check
  CHECK (level IN ('coordinator', 'management', 'hs_coordinator'));

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_escalation_level_current()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.level = 'hs_coordinator' THEN
    RAISE EXCEPTION 'hs_coordinator is a historical escalation level and cannot be inserted'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_escalation_level_current
  BEFORE INSERT ON corrective_action_escalation
  FOR EACH ROW EXECUTE FUNCTION hs_escalation_level_current();
