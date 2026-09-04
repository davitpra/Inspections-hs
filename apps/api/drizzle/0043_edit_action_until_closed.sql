-- Requisitos §3 R2 y §7 etapa 4 — LA ASIGNACIÓN SE CORRIGE HASTA EL CIERRE (ADR-020).
--
-- PRECONDICIÓN: no existen datos regulatorios de producción. Las enmiendas de desarrollo se
-- consolidan sobre la única fila operativa y la tabla introducida por 0041 se retira.
--
-- `corrective_action` deja de ser totalmente inmutable, pero NO queda confiada al servicio:
-- hs_app recibe UPDATE solo sobre tres columnas y una guarda alcanza también al dueño. El estado
-- sigue derivándose del último evento; `closed` congela la asignación definitivamente.

-- ---------------------------------------------------------------------------
-- 1. Consolidar el último valor de desarrollo antes de retirar las enmiendas.
SELECT set_config(
  'app.site_ids',
  coalesce((SELECT string_agg(id::text, ',') FROM site), ''),
  true
);

--> statement-breakpoint

DROP TRIGGER corrective_action_forbid_mutation ON corrective_action;

--> statement-breakpoint

UPDATE corrective_action a
   SET assignee_person_id = latest.assignee_person_id,
       description = latest.description,
       due_at = latest.due_at
  FROM (
    SELECT DISTINCT ON (action_id) action_id, assignee_person_id, description, due_at
      FROM corrective_action_commitment_amendment
     ORDER BY action_id, position DESC
  ) latest
 WHERE latest.action_id = a.id;

--> statement-breakpoint

DROP TABLE corrective_action_commitment_amendment;

--> statement-breakpoint

DROP FUNCTION hs_action_amendment_guard();

--> statement-breakpoint

DROP FUNCTION hs_action_amendment_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. La guarda de la única asignación vigente.
CREATE OR REPLACE FUNCTION hs_corrective_action_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  current_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'corrective_action is append-only; DELETE is forbidden'
      USING ERRCODE = 'HS001';
  END IF;

  IF (to_jsonb(OLD) - ARRAY['assignee_person_id', 'description', 'due_at'])
     IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['assignee_person_id', 'description', 'due_at']) THEN
    RAISE EXCEPTION 'only the active assignment of corrective_action may change'
      USING ERRCODE = 'HS001';
  END IF;

  IF NEW.assignee_person_id IS DISTINCT FROM OLD.assignee_person_id
     AND NOT EXISTS (
       SELECT 1
         FROM person p
        WHERE p.id = NEW.assignee_person_id
          AND p.site_id = OLD.site_id
          AND p.deactivated_at IS NULL
     ) THEN
    RAISE EXCEPTION 'the assignee must be active and belong to the action site'
      USING ERRCODE = 'HS003';
  END IF;

  SELECT e.to_state INTO current_state
    FROM corrective_action_event e
   WHERE e.action_id = OLD.id
   ORDER BY e.position DESC
   LIMIT 1;

  IF current_state = 'closed' THEN
    RAISE EXCEPTION 'action % is closed and its assignment is frozen', OLD.id
      USING ERRCODE = 'HS014',
            HINT = 'A closed corrective action is a final record.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_guard
  BEFORE UPDATE OR DELETE ON corrective_action
  FOR EACH ROW EXECUTE FUNCTION hs_corrective_action_guard();

--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON corrective_action FROM hs_app;

--> statement-breakpoint

GRANT UPDATE (assignee_person_id, description, due_at) ON corrective_action TO hs_app;

-- RLS ya está ENABLE + FORCE y su política sigue siendo la de 0011. No se recrea ni se relaja.

-- ---------------------------------------------------------------------------
-- 3. Toda transición toma la fila padre antes de leer el estado. UPDATE y cierre quedan así
-- serializados incluso cuando el INSERT no pasó por el servicio.
CREATE OR REPLACE FUNCTION hs_action_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  last_state text;
  last_position integer;
BEGIN
  PERFORM 1 FROM corrective_action WHERE id = NEW.action_id FOR UPDATE;

  SELECT e.to_state, e.position INTO last_state, last_position
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
   ORDER BY e.position DESC
   LIMIT 1;

  IF NEW.from_state IS DISTINCT FROM last_state THEN
    RAISE EXCEPTION
      'action % is in state %, not %', NEW.action_id, coalesce(last_state, '(none)'),
      coalesce(NEW.from_state, '(none)')
      USING ERRCODE = 'HS004',
            HINT = 'An event applies to the current state of its action.';
  END IF;

  IF NEW.position IS DISTINCT FROM coalesce(last_position + 1, 0) THEN
    RAISE EXCEPTION
      'action % expects position %, got %',
      NEW.action_id, coalesce(last_position + 1, 0), NEW.position
      USING ERRCODE = 'HS004',
            HINT = 'The event history of an action has no gaps.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM (VALUES
        (NULL,                    'open'),
        ('open',                  'in_progress'),
        ('in_progress',           'awaiting_verification'),
        ('awaiting_verification', 'closed'),
        ('awaiting_verification', 'in_progress')
      ) AS allowed(from_state, to_state)
     WHERE allowed.from_state IS NOT DISTINCT FROM NEW.from_state
       AND allowed.to_state = NEW.to_state
  ) THEN
    RAISE EXCEPTION
      'transition % -> % is not allowed', coalesce(NEW.from_state, '(none)'), NEW.to_state
      USING ERRCODE = 'HS004',
            HINT = 'The state transition is not allowed.';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. La creación audita identidad estable; el cierre, la asignación definitiva.
CREATE OR REPLACE FUNCTION hs_action_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.created',
    jsonb_strip_nulls(jsonb_build_object(
      'action_id', NEW.id,
      'finding_id', NEW.finding_id,
      'investigation_id', NEW.investigation_id,
      'site_id', NEW.site_id,
      'remediation_group_id', NEW.remediation_group_id,
      'created_by', NEW.created_by)),
    NEW.created_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_action_event_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
  final_action corrective_action%ROWTYPE;
BEGIN
  body := jsonb_build_object(
    'action_id', NEW.action_id,
    'event_id', NEW.id,
    'site_id', NEW.site_id,
    'position', NEW.position,
    'from_state', NEW.from_state,
    'to_state', NEW.to_state,
    'actor_user_id', NEW.actor_user_id,
    'reason', NEW.reason);

  IF NEW.to_state = 'closed' THEN
    SELECT * INTO STRICT final_action FROM corrective_action WHERE id = NEW.action_id;
    body := body || jsonb_build_object(
      'assignee_person_id', final_action.assignee_person_id,
      'description', final_action.description,
      'due_at', final_action.due_at);
  END IF;

  PERFORM hs_audit_entry_at(NEW.site_id, 'action.transitioned', body, NEW.occurred_at);
  RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Una notificación retirada desaparece de la bandeja, pero nunca se elimina.
ALTER TABLE notification ADD COLUMN withdrawn_at timestamptz;

--> statement-breakpoint

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

REVOKE UPDATE ON notification FROM hs_app;

--> statement-breakpoint

GRANT UPDATE (read_at, withdrawn_at) ON notification TO hs_app;

--> statement-breakpoint

DROP INDEX notification_inbox_idx;

--> statement-breakpoint

CREATE INDEX notification_inbox_idx
  ON notification (user_id, read_at NULLS FIRST, created_at DESC)
  WHERE withdrawn_at IS NULL;
