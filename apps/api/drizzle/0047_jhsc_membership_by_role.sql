-- ADR-023 — La membresía del JHSC se deriva del rol y no de un asiento separado.
--
-- `app_user` no tiene política RLS: no tiene sitio, tiene alcance (`0005` §10),
-- por lo que esta migración no toca políticas. `hs_identity_guard` queda intacto.
-- Los tipos `user.jhsc_seat_granted` y `user.jhsc_seat_withdrawn` tampoco se
-- retiran de un catálogo inexistente; las entradas históricas de la cadena son
-- inmutables y deben seguir siendo legibles.

-- La función todavía depende de `jhsc_seat_granted_at`, así que se reemplaza antes
-- de eliminar la columna. `CREATE OR REPLACE` no compone el cuerpo anterior.
CREATE OR REPLACE FUNCTION hs_account_changed_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb := jsonb_build_object('account_id', NEW.id, 'person_id', NEW.person_id);
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM hs_account_audit_fanout(
      NEW.id, 'user.role_changed',
      body || jsonb_build_object('previous_role', OLD.role, 'role', NEW.role));
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    PERFORM hs_account_audit_fanout(
      NEW.id, 'user.email_changed',
      body || jsonb_build_object('previous_email', OLD.email, 'email', NEW.email));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_account_audit_fanout(
      NEW.id,
      CASE WHEN NEW.deactivated_at IS NULL THEN 'user.reactivated' ELSE 'user.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

ALTER TABLE app_user DROP CONSTRAINT app_user_jhsc_seat_check;

--> statement-breakpoint

REVOKE UPDATE (email, role, deactivated_at, jhsc_seat_granted_at)
  ON app_user FROM hs_app;

--> statement-breakpoint

ALTER TABLE app_user DROP COLUMN jhsc_seat_granted_at;

--> statement-breakpoint

GRANT UPDATE (email, role, deactivated_at) ON app_user TO hs_app;
