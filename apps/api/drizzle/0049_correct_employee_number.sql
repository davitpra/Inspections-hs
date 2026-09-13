-- Corrige un número de empleado sin partir el historial de la persona.
-- `id` y `created_at` siguen siendo asignados una sola vez. La política RLS de
-- `person` no cambia.

CREATE OR REPLACE FUNCTION hs_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  offending text;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  frozen text[];
  col text;
BEGIN
  frozen := CASE TG_TABLE_NAME
    WHEN 'person' THEN ARRAY['id', 'created_at']
    WHEN 'app_user' THEN ARRAY['id', 'person_id', 'created_at']
    WHEN 'user_site_scope' THEN ARRAY['id', 'user_id', 'site_id', 'granted_at']
  END;

  FOREACH col IN ARRAY frozen LOOP
    IF old_row ->> col IS DISTINCT FROM new_row ->> col THEN
      offending := col;
      EXIT;
    END IF;
  END LOOP;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'column %.% is assigned once and cannot be changed', TG_TABLE_NAME, offending
      USING ERRCODE = 'HS001',
            HINT = 'Deactivate the record and register a new one instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

GRANT UPDATE (employee_number) ON person TO hs_app;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_person_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'person_id', NEW.id,
    'employee_number', NEW.employee_number);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.created',
      body || jsonb_build_object('first_name', NEW.first_name, 'last_name', NEW.last_name));

    RETURN NULL;
  END IF;

  IF NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.renamed',
      body || jsonb_build_object(
        'previous_first_name', OLD.first_name,
        'previous_last_name', OLD.last_name,
        'first_name', NEW.first_name,
        'last_name', NEW.last_name));
  END IF;

  IF NEW.employee_number IS DISTINCT FROM OLD.employee_number THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.renumbered',
      body || jsonb_build_object(
        'previous_employee_number', OLD.employee_number,
        'employee_number', NEW.employee_number));
  END IF;

  IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
    PERFORM hs_identity_audit_entry(
      OLD.site_id, 'person.transferred',
      body || jsonb_build_object('from_site_id', OLD.site_id, 'to_site_id', NEW.site_id));

    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.transferred',
      body || jsonb_build_object('from_site_id', OLD.site_id, 'to_site_id', NEW.site_id));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id,
      CASE WHEN NEW.deactivated_at IS NULL THEN 'person.reactivated' ELSE 'person.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  RETURN NULL;
END;
$fn$;
