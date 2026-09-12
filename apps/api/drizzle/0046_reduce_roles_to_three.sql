-- ADR-022 — Retirada preproducción de `supervisor` y `external_auditor`.
--
-- Escrita a mano. La migración se niega a convertir datos retirados: si aparece uno,
-- el despliegue debe detenerse y la decisión debe revisarse fuera de este DDL.
-- Las dos tablas de eventos llevan FORCE RLS. El dueño lo suspende dentro de la misma
-- transacción para que el guard vea todas las plantas; los locks de ALTER impiden que
-- exista una ventana concurrente y un rechazo revierte también estos dos cambios.
ALTER TABLE corrective_action_escalation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notification NO FORCE ROW LEVEL SECURITY;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_user WHERE role IN ('supervisor', 'external_auditor')
  ) THEN
    RAISE EXCEPTION 'cannot retire an app_user role while a row still carries it';
  END IF;

  IF EXISTS (
    SELECT 1 FROM corrective_action_escalation WHERE level = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'cannot retire the supervisor escalation level while a row still carries it';
  END IF;

  IF EXISTS (
    SELECT 1 FROM notification WHERE kind = 'corrective_action_overdue_supervisor'
  ) THEN
    RAISE EXCEPTION 'cannot retire the supervisor notification kind while a row still carries it';
  END IF;
END;
$guard$;

--> statement-breakpoint

ALTER TABLE corrective_action_escalation FORCE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

-- Estas funciones se reemplazan antes de quitar `expires_at`: Postgres registra su
-- dependencia con la columna. Cuenta activa pasa a significar únicamente no dada de baja.
CREATE OR REPLACE FUNCTION hs_account_is_active(account app_user)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT account.deactivated_at IS NULL;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_account_created_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_account_audit_fanout(
    NEW.id, 'user.created',
    jsonb_build_object(
      'account_id', NEW.id,
      'person_id', NEW.person_id,
      'email', NEW.email,
      'role', NEW.role));

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- Versión más reciente de la función (0035), sin la rama de vencimiento retirada.
-- Conserva la auditoría de rol, email, ciclo de baja y asiento JHSC.
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

  IF NEW.jhsc_seat_granted_at IS DISTINCT FROM OLD.jhsc_seat_granted_at THEN
    PERFORM hs_account_audit_fanout(
      NEW.id,
      CASE WHEN NEW.jhsc_seat_granted_at IS NULL
           THEN 'user.jhsc_seat_withdrawn' ELSE 'user.jhsc_seat_granted' END,
      body || jsonb_build_object('jhsc_seat_granted_at', NEW.jhsc_seat_granted_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- `app_user` no lleva RLS (0005 §10): su alcance es otra tabla y se lee para construir
-- la sesión. `hs_identity_guard` queda intacto y sigue congelando id, person_id y created_at.
ALTER TABLE app_user DROP CONSTRAINT app_user_role_check;

--> statement-breakpoint

ALTER TABLE app_user ADD CONSTRAINT app_user_role_check
  CHECK (role IN ('hs_coordinator', 'jhsc_member', 'management'));

--> statement-breakpoint

ALTER TABLE app_user DROP CONSTRAINT app_user_jhsc_seat_check;

--> statement-breakpoint

ALTER TABLE app_user ADD CONSTRAINT app_user_jhsc_seat_check
  CHECK (jhsc_seat_granted_at IS NULL OR role IN ('hs_coordinator', 'management'));

--> statement-breakpoint

ALTER TABLE app_user DROP CONSTRAINT app_user_auditor_lifecycle;

--> statement-breakpoint

-- `app_user` es parcialmente mutable. Se retira primero el conjunto anterior y se
-- concede después exactamente el conjunto vigente, sin alterar SELECT, INSERT ni DELETE.
REVOKE UPDATE (email, role, expires_at, records_from, records_to, deactivated_at,
               jhsc_seat_granted_at)
  ON app_user FROM hs_app;

--> statement-breakpoint

ALTER TABLE app_user DROP COLUMN expires_at, DROP COLUMN records_from, DROP COLUMN records_to;

--> statement-breakpoint

GRANT UPDATE (email, role, deactivated_at, jhsc_seat_granted_at) ON app_user TO hs_app;

--> statement-breakpoint

-- Se retira solo la ventana adicional de `audit_log`. Su política permisiva de
-- aislamiento por sitio, FORCE RLS, inmutabilidad y todas las entradas existentes
-- permanecen intactas, incluidas las que históricamente describan lecturas de auditor.
DROP POLICY audit_log_record_window ON audit_log;

--> statement-breakpoint

DROP FUNCTION hs_apply_record_window(regclass, text);

--> statement-breakpoint

DROP FUNCTION hs_record_window_from();

--> statement-breakpoint

DROP FUNCTION hs_record_window_to();

--> statement-breakpoint

DROP FUNCTION hs_auditor_read_event(uuid, jsonb);

--> statement-breakpoint

-- `corrective_action_escalation` sigue bajo `hs_make_immutable` y RLS por sitio.
-- Este DDL del dueño cambia el CHECK sin insertar, actualizar ni eliminar filas.
ALTER TABLE corrective_action_escalation
  DROP CONSTRAINT corrective_action_escalation_level_check;

--> statement-breakpoint

ALTER TABLE corrective_action_escalation
  ADD CONSTRAINT corrective_action_escalation_level_check
  CHECK (level IN ('hs_coordinator', 'management'));

--> statement-breakpoint

-- `notification` no es totalmente inmutable: conserva UPDATE solo sobre `read_at` y
-- `withdrawn_at`, ambas marcas monotónicas protegidas por su guarda. Conserva RLS por
-- sitio y prohibiciones de DELETE/TRUNCATE. Este DDL tampoco escribe ninguna fila.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;

--> statement-breakpoint

ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'inspection_period_opened',
  'corrective_action_assigned',
  'corrective_action_overdue_coordinator',
  'corrective_action_overdue_management',
  'incident_reported'));
