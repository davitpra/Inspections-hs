-- Requisitos §3 R2 y §7 etapa 4 — LA ASIGNACIÓN SE CONGELA AL DECLARAR EL TRABAJO HECHO
-- (ADR-021, supersede ADR-020).
--
-- 0043 dejó la asignación corregible hasta `closed`. Eso permitía cambiar el responsable de un
-- trabajo YA DECLARADO HECHO —el cierre nombraría a quien no lo ejecutó— y reescribir el
-- enunciado contra el que el verificador está mirando la evidencia. La frontera se adelanta a
-- `awaiting_verification`.
--
-- Corregir durante la verificación sigue siendo posible, pero por el rechazo
-- (`awaiting_verification → in_progress`), que es un evento del stream y no una escritura
-- silenciosa sobre la fila.
--
-- NO CAMBIA NADA MÁS: el `GRANT UPDATE (assignee_person_id, description, due_at)` de 0043 sigue
-- siendo el privilegio correcto, `REVOKE UPDATE, DELETE, TRUNCATE` sigue en pie para el resto, y
-- la política RLS es la de 0011 —`ENABLE` + `FORCE`—, que no se recrea ni se relaja. Tampoco hay
-- datos que convertir: solo se reemplaza el cuerpo de la guarda.

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

  -- El mismo SQLSTATE que usaba el cierre: para quien pide la corrección es el mismo rechazo
  -- —la asignación ya no es un compromiso— y se traduce igual a `invalid_action_state`.
  IF current_state IN ('awaiting_verification', 'closed') THEN
    RAISE EXCEPTION
      'action % has its work declared done and its assignment is frozen', OLD.id
      USING ERRCODE = 'HS014',
            HINT = 'Refuse the verification to return the action to in_progress before correcting it.';
  END IF;

  RETURN NEW;
END;
$fn$;
