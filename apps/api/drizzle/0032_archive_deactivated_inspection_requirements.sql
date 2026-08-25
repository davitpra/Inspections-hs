-- 0032 — Archivar requisitos de inspección desactivados.
--
-- TABLA INMUTABLE TOCADA: `inspection_schedule`. `archived_at` es una marca de
-- presentación reversible; no altera la ventana operativa ni los períodos producidos.

ALTER TABLE inspection_schedule
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT inspection_schedule_archive_check
    CHECK (archived_at IS NULL OR deactivated_at IS NOT NULL);

--> statement-breakpoint

-- Reafirmar la lista completa evita heredar por accidente un UPDATE amplio.
REVOKE UPDATE ON inspection_schedule FROM hs_app;
GRANT UPDATE (default_inspector_id, deactivated_at, archived_at)
  ON inspection_schedule TO hs_app;

--> statement-breakpoint

-- Parte de la versión de 0030: conserva el avance monótono de versión y permite
-- únicamente que `archived_at` quede fuera de las columnas congeladas.
CREATE OR REPLACE FUNCTION hs_scheduling_guard()
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
    WHEN 'inspection_schedule' THEN
      ARRAY['id', 'site_id', 'template_id', 'created_at', 'created_by',
            'frequency_months', 'anchor_month']
    WHEN 'scheduled_inspection' THEN
      ARRAY['id', 'site_id', 'period_start', 'period_months', 'template_id',
            'scheduled_at', 'scheduled_by']
    WHEN 'notification' THEN
      ARRAY['id', 'user_id', 'site_id', 'kind', 'dedupe_key', 'payload', 'created_at']
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
            HINT = 'Cancel the record and register a new one instead.';
  END IF;

  IF TG_TABLE_NAME = 'scheduled_inspection'
     AND new_row ->> 'template_version_id' IS DISTINCT FROM old_row ->> 'template_version_id' THEN
    IF (
      SELECT version FROM template_version WHERE id = NEW.template_version_id
    ) <= (
      SELECT version FROM template_version WHERE id = OLD.template_version_id
    ) THEN
      RAISE EXCEPTION
        'a scheduled inspection can only advance to a higher template version'
        USING ERRCODE = 'HS001',
              HINT = 'Advance it to a newer published version of the same template.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM inspection WHERE scheduled_inspection_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'a submitted inspection cannot advance to another template version'
        USING ERRCODE = 'HS001',
              HINT = 'Keep the version used by the submitted inspection.';
    END IF;

    IF old_row ->> 'cancelled_at' IS NOT NULL THEN
      RAISE EXCEPTION
        'a cancelled inspection cannot advance to another template version'
        USING ERRCODE = 'HS001',
              HINT = 'Schedule the period again instead of changing the cancelled record.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'scheduled_inspection'
     AND old_row ->> 'cancelled_at' IS NOT NULL
     AND new_row ->> 'cancelled_at' IS NULL THEN
    RAISE EXCEPTION
      'a cancelled inspection cannot be reopened'
      USING ERRCODE = 'HS001',
            HINT = 'Schedule the period again instead of clearing the cancellation.';
  END IF;

  IF TG_TABLE_NAME = 'notification'
     AND old_row ->> 'read_at' IS NOT NULL
     AND new_row ->> 'read_at' IS NULL THEN
    RAISE EXCEPTION
      'a notification cannot be marked unread'
      USING ERRCODE = 'HS001';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

-- Parte de la versión de 0029: el alta sigue registrando frecuencia y ancla.
CREATE OR REPLACE FUNCTION hs_inspection_schedule_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'inspection_schedule_id', NEW.id,
    'site_id', NEW.site_id,
    'template_id', NEW.template_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.created',
      body || jsonb_build_object(
        'default_inspector_id', NEW.default_inspector_id,
        'frequency_months', NEW.frequency_months,
        'anchor_month', NEW.anchor_month));

    RETURN NULL;
  END IF;

  IF NEW.default_inspector_id IS DISTINCT FROM OLD.default_inspector_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.inspector_changed',
      body || jsonb_build_object(
        'previous_default_inspector_id', OLD.default_inspector_id,
        'default_inspector_id', NEW.default_inspector_id));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id,
      CASE WHEN NEW.deactivated_at IS NULL
           THEN 'inspection_schedule.reactivated'
           ELSE 'inspection_schedule.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.archived',
      body || jsonb_build_object('archived_at', NEW.archived_at));
  END IF;

  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.restored',
      body || jsonb_build_object('archived_at', NEW.archived_at));
  END IF;

  RETURN NULL;
END;
$fn$;
