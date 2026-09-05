-- 0045 — Hacer visible anticipadamente un período ya abierto.
--
-- TABLA INMUTABLE TOCADA: `scheduled_inspection` (ADR-002 / ADR-004).
-- `visible_early` deja de ser asignada una sola vez y pasa a ser MONÓTONA: puede avanzar
-- de false a true, pero nunca volver a false. El motor también impide reescribir una
-- cancelada o una inspección con envío aceptado.
--
-- RLS NO CAMBIA: `scheduled_inspection` conserva ENABLE + FORCE y las políticas de 0008.

REVOKE UPDATE ON scheduled_inspection FROM hs_app;

--> statement-breakpoint

-- La lista completa de columnas mutables queda declarada junta otra vez. El privilegio
-- de tabla sigue revocado; hs_app solo puede escribir estas cinco columnas.
GRANT UPDATE (inspector_id, cancelled_at, cancellation_reason, template_version_id, visible_early)
  ON scheduled_inspection TO hs_app;

--> statement-breakpoint

-- Copia la definición vigente de 0043 y agrega únicamente la transición de visibilidad.
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
     AND new_row ->> 'visible_early' IS DISTINCT FROM old_row ->> 'visible_early' THEN
    IF OLD.visible_early OR NOT NEW.visible_early THEN
      RAISE EXCEPTION 'early visibility cannot be reversed'
        USING ERRCODE = 'HS001';
    END IF;

    IF OLD.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'a cancelled inspection cannot change early visibility'
        USING ERRCODE = 'HS001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM inspection WHERE scheduled_inspection_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'a submitted inspection cannot change early visibility'
        USING ERRCODE = 'HS001';
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
    RAISE EXCEPTION 'a notification cannot be marked unread'
      USING ERRCODE = 'HS001';
  END IF;

  IF TG_TABLE_NAME = 'notification'
     AND old_row ->> 'withdrawn_at' IS NOT NULL
     AND new_row ->> 'withdrawn_at' IS NULL THEN
    RAISE EXCEPTION 'a withdrawn notification cannot be restored'
      USING ERRCODE = 'HS001';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

-- Copia la definición vigente de 0036 y agrega un hecho para la nueva transición.
CREATE OR REPLACE FUNCTION hs_scheduled_inspection_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'scheduled_inspection_id', NEW.id,
    'site_id', NEW.site_id,
    'period_start', NEW.period_start,
    'period_end', NEW.period_end,
    'template_id', NEW.template_id,
    'template_version_id', NEW.template_version_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.scheduled',
      body || jsonb_build_object(
        'inspector_id', NEW.inspector_id,
        'scheduled_by', NEW.scheduled_by,
        'visible_early', NEW.visible_early));

    RETURN NULL;
  END IF;

  IF NEW.inspector_id IS DISTINCT FROM OLD.inspector_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.reassigned',
      body || jsonb_build_object(
        'previous_inspector_id', OLD.inspector_id,
        'inspector_id', NEW.inspector_id));
  END IF;

  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.cancelled',
      body || jsonb_build_object(
        'cancelled_at', NEW.cancelled_at,
        'cancellation_reason', NEW.cancellation_reason));
  END IF;

  IF NEW.template_version_id IS DISTINCT FROM OLD.template_version_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.version_advanced',
      body || jsonb_build_object(
        'previous_template_version_id', OLD.template_version_id));
  END IF;

  IF NEW.visible_early IS DISTINCT FROM OLD.visible_early THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.visibility_advanced', body);
  END IF;

  RETURN NULL;
END;
$fn$;
