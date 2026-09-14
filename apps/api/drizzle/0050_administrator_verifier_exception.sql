-- R3, ADR-002, ADR-019 y ADR-025 — las cuentas administrativas pueden verificar su propio trabajo.
-- Esta migración solo reemplaza la guarda HS005; no altera tablas, GRANTs, REVOKEs ni RLS.

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

  IF actor_role IN ('coordinator', 'management') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'user % declared action % done and cannot verify it', NEW.actor_user_id, NEW.action_id
    USING ERRCODE = 'HS005',
          HINT = 'A corrective action is verified by someone other than whoever did the work, unless they are an administrator.';

  RETURN NEW;
END;
$fn$;
