-- Requisitos §3 R2, §4 y §7 etapa 4 — LA ASIGNACIÓN SE ENMIENDA ANTES DE INICIAR (ADR-018).
--
-- 0011 dejó el compromiso —responsable, trabajo y plazo— en la fila inmutable de
-- `corrective_action`, sin forma de corregir una equivocación detectada antes de empezar.
-- Esta migración agrega el stream append-only donde vive cada corrección: una instantánea
-- completa por enmienda, con su posición, su actor y su instante. La fila original nunca
-- se toca; sigue siendo la posición cero conceptual y el compromiso vigente hasta que
-- exista una enmienda.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   Una enmienda es una instantánea completa, nunca un PATCH   columnas NOT NULL (§1)
--   Solo se enmienda mientras el estado derivado es `open`     trigger de guarda (§2)
--   Dos enmiendas simultáneas no bifurcan el historial         único (action, position) (§1)
--   El historial no tiene huecos                               trigger de guarda (§2)
--   La enmienda es del mismo sitio que su acción               FK compuesta (§1)
--   Cada enmienda se encadena en la auditoría del sitio        trigger (§3)
--   Nadie modifica ni borra una enmienda                       hs_make_immutable (§4)
--   Nadie ve las enmiendas de la otra planta                   hs_apply_site_isolation (§4)
--
-- LO QUE ESTA MIGRACIÓN NO HACE, y es deliberado:
--
--   NO agrega una columna de estado ni toca `corrective_action_event`. El estado sigue
--   derivándose del stream de eventos (ADR-002); la guarda de §2 lee ese stream, no lo
--   escribe.
--
--   NO recalcula plazos ni escalamientos. `corrective_action_escalation` conserva las
--   filas ya emitidas; el servicio y el cron proyectan el plazo vigente al leer.
--
--   NO reescribe la fila original. Un plazo vigente distinto es otro hecho inmutable, no
--   una corrección del anterior (ADR-014 sigue en pie: el plazo original no se mueve).
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido.
--
-- SQLSTATEs, en el mismo espacio 'HS':
--   HS014  enmienda sobre una acción que ya dejó `open`, o con hueco de posición (nuevo, §2)

-- ---------------------------------------------------------------------------
-- 1. `corrective_action_commitment_amendment` — el stream de correcciones.
CREATE TABLE corrective_action_commitment_amendment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  action_id uuid NOT NULL REFERENCES corrective_action (id),

  -- Denormalizado: la política RLS necesita el sitio en la fila.
  site_id uuid NOT NULL REFERENCES site (id),

  -- LA POSICIÓN DENTRO DE LA ACCIÓN. La fila original de `corrective_action` es la
  -- posición cero conceptual; la primera enmienda es la 1. El único de más abajo es la
  -- barrera de concurrencia, igual que en `corrective_action_event`.
  position integer NOT NULL CHECK (position >= 1),

  -- LA INSTANTÁNEA COMPLETA. Los tres campos del compromiso, sin nulos: una enmienda
  -- reemplaza el compromiso vigente entero, no parchea un campo. El responsable es una
  -- PERSONA del roster, no una cuenta (§3 R2), y sin par con el sitio por lo mismo que
  -- `corrective_action.assignee_person_id` — 0005 documenta por qué `person` no lleva
  -- `UNIQUE (site_id, id)`. Que la persona sea de la planta y esté activa lo comprueba
  -- `actions.service.ts` al aceptar la enmienda.
  assignee_person_id uuid NOT NULL REFERENCES person (id),

  description text NOT NULL,

  due_at timestamptz NOT NULL,

  -- QUIÉN LA HIZO ES UNA CUENTA. Coordinador, o la cuenta que reportó el hallazgo
  -- (ADR-017), resuelto en el servicio.
  actor_user_id uuid NOT NULL REFERENCES app_user (id),

  -- Riesgo C de §5: el reloj del que actúa y el del servidor. Una enmienda se hace
  -- online, así que suelen coincidir, pero el log de auditoría los distingue siempre.
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  -- Mismo mínimo que `amendActionCommitmentRequestSchema` en `@hs/contracts`: el
  -- contrato lo rechaza antes para devolver un error legible, esto lo rechaza igual por
  -- cualquier otro camino.
  CONSTRAINT corrective_action_commitment_amendment_description_check
    CHECK (char_length(description) >= 10),

  -- LA DEFENSA CONTRA LA BIFURCACIÓN DEL HISTORIAL. Dos enmiendas concurrentes calculan
  -- la misma posición siguiente; una confirma y la otra viola este único.
  CONSTRAINT corrective_action_commitment_amendment_position_uq UNIQUE (action_id, position),

  -- La enmienda es del mismo sitio que su acción. Sin esto, la política RLS de una tabla
  -- y la de la otra dirían cosas distintas sobre el mismo registro.
  FOREIGN KEY (action_id, site_id) REFERENCES corrective_action (id, site_id)
);

--> statement-breakpoint

-- "El historial de una acción se lee al revés": la última enmienda es el compromiso
-- vigente. `corrective_action_commitment_amendment_position_uq` ya es un índice sobre
-- (action_id, position), recorrido hacia atrás para `ORDER BY position DESC`. No hace
-- falta un segundo índice sobre las mismas columnas.

-- ---------------------------------------------------------------------------
-- 2. La guarda: solo se enmienda mientras el estado derivado es `open`.
--
-- LEE EL STREAM DE EVENTOS, NO UNA COLUMNA. El estado vigente es el `to_state` del
-- último `corrective_action_event` (ADR-002). Iniciar el trabajo cierra la ventana de
-- corrección; después de eso ninguna enmienda entra.
--
-- ESTA GUARDA NO CIERRA LA CARRERA CON `Start work`, y no pretende hacerlo: el servicio
-- serializa la enmienda y la transición sobre la acción con un advisory lock. El trigger
-- es la barrera de CORRECCIÓN por cualquier otro camino a la tabla.
CREATE OR REPLACE FUNCTION hs_action_amendment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  current_state text;
  last_position integer;
BEGIN
  SELECT e.to_state INTO current_state
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
   ORDER BY e.position DESC
   LIMIT 1;

  IF current_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION
      'action % is in state %, not open', NEW.action_id, coalesce(current_state, '(none)')
      USING ERRCODE = 'HS014',
            HINT = 'A commitment is amended only while its action has not started.';
  END IF;

  SELECT max(a.position) INTO last_position
    FROM corrective_action_commitment_amendment a
   WHERE a.action_id = NEW.action_id;

  IF NEW.position IS DISTINCT FROM coalesce(last_position + 1, 1) THEN
    RAISE EXCEPTION
      'action % expects amendment position %, got %',
      NEW.action_id, coalesce(last_position + 1, 1), NEW.position
      USING ERRCODE = 'HS014',
            HINT = 'The amendment history of an action has no gaps.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_commitment_amendment_guard
  BEFORE INSERT ON corrective_action_commitment_amendment
  FOR EACH ROW EXECUTE FUNCTION hs_action_amendment_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. La auditoría. Cada enmienda deja su eslabón con la instantánea completa, escrito
-- por trigger y no por el servicio: un INSERT que no pasó por el endpoint se encadena
-- igual.
CREATE OR REPLACE FUNCTION hs_action_amendment_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.commitment_amended',
    jsonb_build_object(
      'action_id', NEW.action_id,
      'amendment_id', NEW.id,
      'site_id', NEW.site_id,
      'position', NEW.position,
      'assignee_person_id', NEW.assignee_person_id,
      'due_at', NEW.due_at,
      'actor_user_id', NEW.actor_user_id),
    NEW.occurred_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_commitment_amendment_audit
  AFTER INSERT ON corrective_action_commitment_amendment
  FOR EACH ROW EXECUTE FUNCTION hs_action_amendment_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Inmutabilidad, aislamiento y privilegios.
--
-- SELECT e INSERT, y se acaba la lista. `hs_make_immutable` agrega los triggers que
-- rechazan UPDATE/DELETE/TRUNCATE para CUALQUIER rol, incluido el dueño, y hace el
-- REVOKE explícito a hs_app.
SELECT hs_make_immutable('corrective_action_commitment_amendment');

--> statement-breakpoint

SELECT hs_apply_site_isolation('corrective_action_commitment_amendment');

--> statement-breakpoint

GRANT SELECT, INSERT ON corrective_action_commitment_amendment TO hs_app;
