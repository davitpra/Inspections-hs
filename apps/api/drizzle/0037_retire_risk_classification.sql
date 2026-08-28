-- Retirada preproducción de la clasificación de riesgo (ADR-014).
--
-- PRECONDICIÓN: esta migración solo se puede aplicar antes de cualquier despliegue con
-- datos de producción. Si la base contiene evidencia regulatoria, detener el despliegue
-- y revisar la decisión. La tabla de clasificación se elimina de forma destructiva; no
-- se borra ni se reescribe ninguna fila de `audit_log`.
--
-- El orden importa: la auditoría de acciones deja de leer `severity` antes de quitar la
-- columna. `DROP TABLE` arrastra sus GRANT, políticas RLS, índices, CHECKs y triggers.

-- La acción conserva su auditoría, pero ya no conserva la severidad retirada.
CREATE OR REPLACE FUNCTION hs_action_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.created',
    jsonb_build_object(
      'action_id', NEW.id,
      'finding_id', NEW.finding_id,
      'site_id', NEW.site_id,
      'assignee_person_id', NEW.assignee_person_id,
      'due_at', NEW.due_at,
      'remediation_group_id', NEW.remediation_group_id,
      'created_by', NEW.created_by),
    NEW.created_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

ALTER TABLE corrective_action DROP COLUMN severity;

--> statement-breakpoint

DROP TABLE finding_risk_assessment;

--> statement-breakpoint

DROP FUNCTION hs_finding_assessment_guard();

--> statement-breakpoint

DROP FUNCTION hs_finding_assessment_audit();

--> statement-breakpoint

DROP FUNCTION hs_risk_level(text, text);
