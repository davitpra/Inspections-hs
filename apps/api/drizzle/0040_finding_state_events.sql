-- Estado propio e inmutable del hallazgo.
--
-- El estado no es una columna mutable de `finding`: es un stream append-only derivado
-- del conjunto de acciones correctivas que cuelgan del hallazgo. El agregado es
-- conservador: manda la acción menos avanzada. Una acción todavía sin primer evento se
-- trata como `open`; la restricción diferida de 0011 impide que llegue así al commit.
--
-- La posición única es también la última barrera de concurrencia. Dos eventos de
-- acciones distintas pueden calcular la misma siguiente posición; uno confirma y el
-- otro aborta junto con su evento de acción, que al reintentarse vuelve a derivar el
-- agregado completo.

-- ---------------------------------------------------------------------------
-- 1. El cálculo único del estado agregado.
CREATE OR REPLACE FUNCTION hs_finding_aggregate_state(target_finding_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT coalesce(
    CASE min(CASE coalesce(latest.to_state, 'open')
      WHEN 'open' THEN 1
      WHEN 'in_progress' THEN 2
      WHEN 'awaiting_verification' THEN 3
      WHEN 'closed' THEN 4
    END)
      WHEN 1 THEN 'assigned'
      WHEN 2 THEN 'in_progress'
      WHEN 3 THEN 'verification'
      WHEN 4 THEN 'closed'
    END,
    'raised')
  FROM corrective_action action
  LEFT JOIN LATERAL (
    SELECT event.to_state
      FROM corrective_action_event event
     WHERE event.action_id = action.id
     ORDER BY event.position DESC
     LIMIT 1
  ) latest ON true
  WHERE action.finding_id = target_finding_id;
$fn$;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. El stream propio del hallazgo.
CREATE TABLE finding_state_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  finding_id uuid NOT NULL REFERENCES finding (id),
  site_id uuid NOT NULL REFERENCES site (id),

  position integer NOT NULL CHECK (position >= 0),
  from_state text CHECK (
    from_state IN ('raised', 'assigned', 'in_progress', 'verification', 'closed')),
  to_state text NOT NULL CHECK (
    to_state IN ('raised', 'assigned', 'in_progress', 'verification', 'closed')),

  -- Nulo solamente en el origen del stream: el evento automático de un hallazgo nuevo
  -- o el baseline que esta migración crea para un hallazgo preexistente.
  source_action_event_id uuid,

  -- Nulo únicamente en los baselines de migración. Los eventos posteriores copian al
  -- actor del hallazgo o del evento de acción que los originó.
  actor_user_id uuid REFERENCES app_user (id),

  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finding_state_event_position_uq UNIQUE (finding_id, position),
  CONSTRAINT finding_state_event_id_site_uq UNIQUE (id, site_id),
  CONSTRAINT finding_state_event_origin_check CHECK (
    (from_state IS NULL) = (position = 0)
    AND (source_action_event_id IS NULL) = (position = 0)
    AND (position = 0 OR from_state <> to_state)),

  FOREIGN KEY (finding_id, site_id) REFERENCES finding (id, site_id),
  FOREIGN KEY (source_action_event_id, site_id)
    REFERENCES corrective_action_event (id, site_id)
);

--> statement-breakpoint

CREATE UNIQUE INDEX finding_state_event_source_uq
  ON finding_state_event (source_action_event_id)
  WHERE source_action_event_id IS NOT NULL;

--> statement-breakpoint

CREATE INDEX finding_state_event_site_recorded_idx
  ON finding_state_event (site_id, recorded_at);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Un baseline por cada hallazgo existente.
--
-- Las tablas históricas usan FORCE RLS incluso para su dueño. Durante este backfill el
-- rol migrador necesita ver todos los sitios; NO FORCE conserva RLS para los demás roles
-- y permite que el dueño lea las filas. Se restaura antes de instalar cualquier trigger.
ALTER TABLE finding NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE corrective_action NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE corrective_action_event NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

INSERT INTO finding_state_event (
  finding_id,
  site_id,
  position,
  from_state,
  to_state,
  source_action_event_id,
  actor_user_id,
  occurred_at,
  recorded_at
)
SELECT
  finding.id,
  finding.site_id,
  0,
  NULL,
  hs_finding_aggregate_state(finding.id),
  NULL,
  NULL,
  now(),
  now()
FROM finding;

--> statement-breakpoint

ALTER TABLE corrective_action_event FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE corrective_action FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE finding FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. La guarda del stream y de su derivación.
CREATE OR REPLACE FUNCTION hs_finding_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  last_state text;
  last_position integer;
  expected_state text;
  finding_actor uuid;
  finding_occurred_at timestamptz;
  finding_recorded_at timestamptz;
  source_actor uuid;
  source_occurred_at timestamptz;
  source_recorded_at timestamptz;
BEGIN
  SELECT event.to_state, event.position
    INTO last_state, last_position
    FROM finding_state_event event
   WHERE event.finding_id = NEW.finding_id
   ORDER BY event.position DESC
   LIMIT 1;

  IF NEW.from_state IS DISTINCT FROM last_state
     OR NEW.position IS DISTINCT FROM coalesce(last_position + 1, 0) THEN
    RAISE EXCEPTION
      'finding % expects state % at position %, got % at %',
      NEW.finding_id,
      coalesce(last_state, '(none)'),
      coalesce(last_position + 1, 0),
      coalesce(NEW.from_state, '(none)'),
      NEW.position
      USING ERRCODE = 'HS008',
            HINT = 'A finding state event extends the current stream without gaps.';
  END IF;

  expected_state := hs_finding_aggregate_state(NEW.finding_id);
  IF NEW.to_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION
      'finding % aggregate state is %, not %',
      NEW.finding_id, expected_state, NEW.to_state
      USING ERRCODE = 'HS008',
            HINT = 'Finding state is derived from the current states of its corrective actions.';
  END IF;

  IF NEW.position = 0 THEN
    SELECT finding.reported_by, finding.occurred_at, finding.recorded_at
      INTO finding_actor, finding_occurred_at, finding_recorded_at
      FROM finding
     WHERE finding.id = NEW.finding_id;

    IF NEW.actor_user_id IS DISTINCT FROM finding_actor
       OR NEW.occurred_at IS DISTINCT FROM finding_occurred_at
       OR NEW.recorded_at IS DISTINCT FROM finding_recorded_at THEN
      RAISE EXCEPTION
        'initial state event for finding % does not match its origin', NEW.finding_id
        USING ERRCODE = 'HS008',
              HINT = 'Only the database creates the initial state event of a finding.';
    END IF;
  ELSE
    SELECT event.actor_user_id, event.occurred_at, event.recorded_at
      INTO source_actor, source_occurred_at, source_recorded_at
      FROM corrective_action_event event
      JOIN corrective_action action ON action.id = event.action_id
     WHERE event.id = NEW.source_action_event_id
       AND action.finding_id = NEW.finding_id
       AND NOT EXISTS (
         SELECT 1
           FROM corrective_action_event later
          WHERE later.action_id = event.action_id
            AND later.position > event.position);

    IF source_actor IS NULL
       OR NEW.actor_user_id IS DISTINCT FROM source_actor
       OR NEW.occurred_at IS DISTINCT FROM source_occurred_at
       OR NEW.recorded_at IS DISTINCT FROM source_recorded_at THEN
      RAISE EXCEPTION
        'state event for finding % does not match its source action event', NEW.finding_id
        USING ERRCODE = 'HS008',
              HINT = 'A derived state event copies the source action event actor and timestamps.';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER finding_state_event_guard
  BEFORE INSERT ON finding_state_event
  FOR EACH ROW EXECUTE FUNCTION hs_finding_state_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Los dos productores del stream.
CREATE OR REPLACE FUNCTION hs_finding_initial_state()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO finding_state_event (
    finding_id,
    site_id,
    position,
    from_state,
    to_state,
    actor_user_id,
    occurred_at,
    recorded_at
  ) VALUES (
    NEW.id,
    NEW.site_id,
    0,
    NULL,
    'raised',
    NEW.reported_by,
    NEW.occurred_at,
    NEW.recorded_at
  );

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- `finding_audit` ordena antes alfabéticamente: primero se registra el alta del
-- hallazgo y después su estado inicial.
CREATE TRIGGER finding_state_initial
  AFTER INSERT ON finding
  FOR EACH ROW EXECUTE FUNCTION hs_finding_initial_state();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_finding_state_from_action()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  parent_finding_id uuid;
  current_state text;
  current_position integer;
  aggregate_state text;
BEGIN
  SELECT action.finding_id
    INTO parent_finding_id
    FROM corrective_action action
   WHERE action.id = NEW.action_id;

  -- Las acciones de una investigación no participan en el estado de un hallazgo.
  IF parent_finding_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT event.to_state, event.position
    INTO current_state, current_position
    FROM finding_state_event event
   WHERE event.finding_id = parent_finding_id
   ORDER BY event.position DESC
   LIMIT 1;

  aggregate_state := hs_finding_aggregate_state(parent_finding_id);

  IF aggregate_state IS DISTINCT FROM current_state THEN
    INSERT INTO finding_state_event (
      finding_id,
      site_id,
      position,
      from_state,
      to_state,
      source_action_event_id,
      actor_user_id,
      occurred_at,
      recorded_at
    ) VALUES (
      parent_finding_id,
      NEW.site_id,
      current_position + 1,
      current_state,
      aggregate_state,
      NEW.id,
      NEW.actor_user_id,
      NEW.occurred_at,
      NEW.recorded_at
    );
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- El nombre ordena este trigger después de `corrective_action_event_audit`: el hecho de
-- la acción entra primero en la cadena y su consecuencia agregada después.
CREATE TRIGGER corrective_action_event_finding_state
  AFTER INSERT ON corrective_action_event
  FOR EACH ROW EXECUTE FUNCTION hs_finding_state_from_action();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Todo hallazgo tiene estado al commit.
CREATE OR REPLACE FUNCTION hs_finding_state_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM finding_state_event event WHERE event.finding_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'finding % has no state event', NEW.id
      USING ERRCODE = 'HS009',
            HINT = 'The state of a finding is derived from its immutable event stream.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER finding_state_required
  AFTER INSERT ON finding
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_finding_state_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Auditoría del cambio agregado.
CREATE OR REPLACE FUNCTION hs_finding_state_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'finding.state_changed',
    jsonb_build_object(
      'finding_id', NEW.finding_id,
      'state_event_id', NEW.id,
      'site_id', NEW.site_id,
      'position', NEW.position,
      'from_state', NEW.from_state,
      'to_state', NEW.to_state,
      'source_action_event_id', NEW.source_action_event_id,
      'actor_user_id', NEW.actor_user_id),
    NEW.occurred_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER finding_state_event_audit
  AFTER INSERT ON finding_state_event
  FOR EACH ROW EXECUTE FUNCTION hs_finding_state_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Inmutabilidad, aislamiento y privilegios.
SELECT hs_make_immutable('finding_state_event');

--> statement-breakpoint

SELECT hs_apply_site_isolation('finding_state_event');

--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON finding_state_event FROM hs_app;

--> statement-breakpoint

GRANT SELECT, INSERT ON finding_state_event TO hs_app;
