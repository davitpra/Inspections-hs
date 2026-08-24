-- 0030 — Avanzar explícitamente la versión de una inspección programada.
--
-- `scheduled_inspection.template_version_id` pasa de inmutable a MONÓTONA: puede
-- avanzar a una versión publicada más alta de la misma plantilla, pero no retroceder.
-- El motor también protege que el avance ocurra antes del envío y solo sobre un período
-- vivo. La primera condición conserva una historia temporal coherente; la segunda evita
-- reinterpretar un envío firmado; la tercera evita reabrir una obligación cancelada.
--
-- TABLA INMUTABLE TOCADA: `scheduled_inspection`, bajo el régimen del §5 de 0008. Se
-- concede UPDATE de una sola columna y se reemplazan sus dos funciones de trigger. La
-- columna `inspection.template_version_id` no se toca: es la versión del envío firmado
-- y sigue siendo completamente inmutable para ADR-005.

GRANT UPDATE (template_version_id) ON scheduled_inspection TO hs_app;

--> statement-breakpoint

-- La FK compuesta ya garantiza que la nueva versión pertenece a la misma plantilla que
-- la fila programada; la guarda solo compara el número de versión.
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

  -- Leer por jsonb es necesario: plpgsql no corta antes de evaluar un campo de record
  -- que no existe en las otras tablas que usan esta función.
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
        'scheduled_by', NEW.scheduled_by));

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

  RETURN NULL;
END;
$fn$;
