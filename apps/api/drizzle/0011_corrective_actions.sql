-- Requisitos §4 (AcciónCorrectiva), §3 R2 y R3, y §7 etapa 5 — LA ACCIÓN CORRECTIVA.
--
-- 0010 dejó el hallazgo registrado, ubicado, fotografiado y clasificado, y dejó escrito
-- que nadie tenía todavía la obligación de arreglarlo. Esta migración crea esa
-- obligación: una persona nombrada, una fecha límite derivada de la severidad, un
-- stream de eventos donde queda cada paso, evidencia para cerrarla y un verificador que
-- no puede ser el ejecutor.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   El estado de una acción NO es una columna                     ausencia de columna (§1)
--   La acción es del mismo sitio que su hallazgo                  FK compuesta (§1)
--   La descripción dice algo                                      CHECK de largo (§1)
--   Una acción sin ningún evento no llega a existir               trigger diferido (§4)
--   Solo las 5 transiciones de la máquina son posibles            trigger de guarda (§3)
--   Dos transiciones simultáneas no bifurcan el stream            único (action, position) (§2)
--   Quien ejecutó no puede verificar su propio trabajo            trigger de guarda (§3)
--   Declarar el trabajo hecho exige evidencia `after`             trigger diferido (§5)
--   El rechazo de una verificación exige motivo                   CHECK de motivo (§2)
--   El cron escala una vez por nivel, corra las veces que corra   único (action, level) (§6)
--   Cada acción, transición, evidencia y escalamiento se encadena triggers (§7)
--   Nadie modifica ni borra nada de esto                          hs_make_immutable (§8)
--   Nadie ve las acciones de la otra planta                       hs_apply_site_isolation (§8)
--
-- LO QUE ESTA MIGRACIÓN NO HACE, y es deliberado:
--
--   NO calcula `due_at`. Lo calcula `dueAt()` de `@hs/contracts` y llega resuelto en el
--   INSERT. `timestamptz + interval 'N days'` suma días de CALENDARIO según la zona de
--   la sesión, así que una copia en SQL diferiría de la de TypeScript en una hora
--   cuatro veces al año y ningún test lo notaría hasta marzo. Con una sola
--   implementación no hay nada que pueda divergir. Es la diferencia con la matriz de
--   riesgo de 0010, que sí está escrita dos veces: aquella es una tabla de constantes
--   que SQL reproduce exactamente; ésta depende de un calendario.
--
--   NO tiene columna `status` en `corrective_action`. ADR-002 escribe la consulta que
--   la reemplaza, y esa ausencia es el requisito, no una omisión.
--
--   NO tiene estado `escalated`. Un escalamiento es un hecho sobre una acción vencida,
--   no un paso de su ciclo: si lo fuera, una acción escalada perdería si estaba en
--   progreso o esperando verificación, que es justo lo que el supervisor necesita
--   saber al recibir el aviso.
--
-- ESTA MIGRACIÓN NO ALTERA NINGUNA TABLA INMUTABLE. El único destino de FK compuesta
-- que hace falta —`finding_id_site_uq` (0010)— ya existe.
--
-- SÍ ALTERA UNA TABLA MUTABLE: el `CHECK` de `notification.kind`, para admitir los tres
-- tipos nuevos (§11). `notification` nunca fue inmutable —`read_at` es lo único que
-- cambia en su vida y por eso tiene su `GRANT UPDATE` por columna—, así que ampliar su
-- lista cerrada es una migración normal y no una grieta en el mecanismo. Que la lista
-- esté cerrada es justamente lo que obliga a pasar por acá: un `kind` nuevo no puede
-- aparecer sin que alguien escriba cómo se lee y cómo se muestra.
--
-- LA DEUDA DECLARADA HACIA LA ETAPA 6. §4 dice que una acción correctiva pertenece a
-- exactamente un padre, que es un `Hallazgo` **o** una `Investigación`, con dos FK
-- nulables y un CHECK de exactamente-una. `investigation` no existe todavía, y una FK a
-- una tabla inexistente no se puede escribir; una columna sin FK sería un padre no
-- verificado, que en un registro inmutable es peor que no tenerla. Acá va
-- `finding_id NOT NULL`, y la etapa 6 hace el ALTER que agrega `investigation_id`,
-- relaja el NOT NULL y agrega el CHECK. Es DDL del rol dueño sobre una tabla inmutable,
-- que está permitido: la inmutabilidad es sobre las FILAS, no sobre el esquema.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que las anteriores:
--   HS004  transición que la máquina de estados no permite (nuevo, §3)
--   HS005  quien verifica es quien ejecutó (nuevo, §3)
--   HS006  trabajo declarado hecho sin evidencia, al momento del commit (nuevo, §5)
--   HS007  acción sin ningún evento, al momento del commit (nuevo, §4)

-- ---------------------------------------------------------------------------
-- 1. `corrective_action` — la obligación.
CREATE TABLE corrective_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- El padre. Uno a muchos: un hallazgo puede tener varias acciones, una acción cubre
  -- un solo hallazgo (pregunta cerrada 9). Con muchos-a-muchos habría que inventar qué
  -- severidad manda en la fecha límite, y una sola verificación cerraría siete
  -- hallazgos de un plumazo — que es lo contrario de lo que R3 pide.
  --
  -- NOT NULL hasta la etapa 6. Ver la nota de la cabecera.
  finding_id uuid NOT NULL REFERENCES finding (id),

  -- EL RESPONSABLE ES UNA PERSONA, NO UNA CUENTA (§3 R2: "una persona nombrada").
  --
  -- Referencia a `person (id)` A SECAS, sin par con el sitio, y no es un descuido: 0005
  -- documenta que `person` NO lleva `UNIQUE (site_id, id)` a propósito, porque
  -- `person.site_id` es mutable y congelar el par haría que transferir a alguien entre
  -- plantas invalide retroactivamente —o con ON UPDATE CASCADE reescriba— todos los
  -- registros que lo nombran. Que el responsable sea del sitio de la acción se
  -- comprueba al crearla (`actions.service.ts`), y que el selector solo ofrezca gente
  -- del sitio lo garantiza la política RLS de `person`.
  assignee_person_id uuid NOT NULL REFERENCES person (id),

  description text NOT NULL,

  -- LA SEVERIDAD DE LA QUE SALIÓ EL PLAZO, congelada acá el día que la acción se creó.
  --
  -- Se copia y no se lee de la clasificación vigente del hallazgo a propósito: si el
  -- coordinador reclasifica después, el plazo de esta acción NO se mueve, y el registro
  -- puede seguir diciendo qué se prometió el día que se prometió. La lista es la misma
  -- que la de `finding_risk_assessment` en 0010 y la de `SEVERITIES` en `@hs/contracts`.
  severity text NOT NULL CHECK (
    severity IN ('negligible', 'minor', 'moderate', 'major', 'catastrophic')),

  -- Calculada por `dueAt()` en el servidor. Ver la nota de la cabecera sobre por qué no
  -- hay una función SQL que la reproduzca.
  due_at timestamptz NOT NULL,

  -- LA REMEDIACIÓN COMPARTIDA DE LA PREGUNTA CERRADA 9: opcional y SIN SEMÁNTICA.
  --
  -- "Instalar guardas en las 7 líneas" son siete acciones, cada una con su fecha
  -- derivada de su propia severidad y su propia verificación; esto solo las agrupa en
  -- la UI y en reportes. Sin FK y sin tabla propia porque no es una entidad: es una
  -- etiqueta. El día que necesite nombre y dueño, será una tabla y este comentario
  -- estará equivocado — hasta entonces, una tabla sería inventarle importancia.
  remediation_group_id uuid,

  created_by uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Mismo mínimo que `createActionRequestSchema` en `@hs/contracts`: el contrato lo
  -- rechaza antes para devolver un error legible, esto lo rechaza igual por cualquier
  -- otro camino. "arreglar" no es una acción correctiva.
  CONSTRAINT corrective_action_description_check CHECK (char_length(description) >= 10),

  -- La acción es del mismo sitio que su hallazgo. Sin esto, la política RLS de una
  -- tabla y la de la otra dirían cosas distintas sobre el mismo registro.
  FOREIGN KEY (finding_id, site_id) REFERENCES finding (id, site_id)
);

--> statement-breakpoint

-- NO HAY COLUMNA `status`, Y ESA AUSENCIA ES EL REQUISITO (ADR-002).
--
-- El estado vigente es esta consulta, escrita en el ADR con estas palabras:
--
--   SELECT DISTINCT ON (e.action_id) e.action_id, e.to_state
--     FROM corrective_action_event e
--    ORDER BY e.action_id, e.position DESC
--
-- Una columna cacheada exigiría UPDATE sobre una tabla que no lo tiene, y el día que
-- difiriera del stream nadie sabría cuál de las dos manda. Con 24 inspecciones al año y
-- 200 personas, derivarla no cuesta nada durante toda la vida útil del sistema.

-- El destino de las FK compuestas de las otras tres tablas.
ALTER TABLE corrective_action
  ADD CONSTRAINT corrective_action_id_site_uq UNIQUE (id, site_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `corrective_action_event` — el stream.
--
-- §4: "El progreso es un stream de eventos, no un campo de estado". Cada transición es
-- una fila que nadie puede tocar después.
CREATE TABLE corrective_action_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  action_id uuid NOT NULL REFERENCES corrective_action (id),
  site_id uuid NOT NULL REFERENCES site (id),

  -- EL ORDEN DENTRO DE LA ACCIÓN. ADR-002 lo llama `seq`; acá es un entero POR ACCIÓN y
  -- no un bigserial global, y la diferencia es la que importa:
  --
  -- Un bigserial global ordena pero no protege. Dos requests que mueven la misma acción
  -- a la vez tomarían dos valores distintos y ambos commitearían, dejando dos eventos
  -- que parten del mismo estado y un stream bifurcado. Con `position` calculada como
  -- "la última de ESTA acción + 1", la carrera la resuelve el único de más abajo: uno
  -- commitea y el otro muere con violación de unicidad. Es el mismo problema que la
  -- reclasificación concurrente de 0010 y merece la misma defensa, no una nueva.
  --
  -- El orden global, cuando haga falta, lo da `recorded_at` y sobre todo la cadena de
  -- `audit_log`, que ya es un orden total por sitio.
  position integer NOT NULL CHECK (position >= 0),

  -- NULL solo en el evento de creación: la acción todavía no tenía estado.
  from_state text CHECK (
    from_state IN ('open', 'in_progress', 'awaiting_verification', 'closed')),

  to_state text NOT NULL CHECK (
    to_state IN ('open', 'in_progress', 'awaiting_verification', 'closed')),

  -- QUIÉN LO HIZO ES UNA CUENTA, no una persona. `assignee_person_id` dice de quién era
  -- la obligación; esto dice quién tocó el sistema. Son dos hechos distintos: una
  -- persona del roster sin cuenta tiene acciones a su nombre y es el coordinador quien
  -- registra el avance, y la cadena de auditoría tiene que poder decir eso.
  actor_user_id uuid NOT NULL REFERENCES app_user (id),

  note text,

  -- El motivo del rechazo de una verificación. Obligatorio ahí y solo ahí.
  reason text,

  -- Riesgo C de §5, igual que en `finding`: el reloj del que actúa y el del servidor.
  -- Acá los dos suelen coincidir —una acción se ejecuta online (design D15)— pero la
  -- columna existe porque el log de auditoría los distingue siempre.
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  -- LA DEFENSA CONTRA LA BIFURCACIÓN. Ver el comentario de `position`.
  CONSTRAINT corrective_action_event_position_uq UNIQUE (action_id, position),

  -- El destino de la FK compuesta de la evidencia.
  CONSTRAINT corrective_action_event_id_site_uq UNIQUE (id, site_id),

  -- El primer evento y solo el primero nace sin estado previo.
  CONSTRAINT corrective_action_event_origin_check CHECK (
    (from_state IS NULL) = (position = 0)),

  -- RECHAZAR UNA VERIFICACIÓN EXIGE DECIR POR QUÉ. Devolver el trabajo sin explicar qué
  -- falta deja a quien lo ejecutó sin nada que corregir, y al registro sin la parte
  -- interesante. `open → in_progress` no lo exige: empezar a trabajar no necesita
  -- justificación.
  CONSTRAINT corrective_action_event_reason_check CHECK (
    NOT (from_state = 'awaiting_verification' AND to_state = 'in_progress')
    OR reason IS NOT NULL),

  FOREIGN KEY (action_id, site_id) REFERENCES corrective_action (id, site_id)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Las dos guardas de la máquina de estados.
--
-- LA TABLA DE TRANSICIONES, ESCRITA POR SEGUNDA VEZ. La primera está en
-- `packages/contracts/src/actions.ts` y es la que el endpoint y la UI consultan; ésta
-- existe porque el endpoint no es el único camino a la tabla. SQL no puede importar
-- TypeScript, así que la única defensa contra la divergencia es una prueba:
-- `corrective-actions.int-spec.ts` evalúa los 20 pares ordenados por los dos caminos y
-- los compara, igual que 0010 compara las 25 celdas de la matriz de riesgo.
--
-- `closed` no aparece como origen en ninguna fila: es terminal. Que el trabajo cerrado
-- se haya deshecho es un hallazgo nuevo, con su fecha y su clasificación, que es además
-- lo único que la recurrencia de la etapa 7 puede contar.
CREATE OR REPLACE FUNCTION hs_action_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  last_state text;
  last_position integer;
BEGIN
  SELECT e.to_state, e.position INTO last_state, last_position
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
   ORDER BY e.position DESC
   LIMIT 1;

  -- ESTA GUARDA NO CIERRA LA CARRERA, Y NO PRETENDE HACERLO. Dos transacciones
  -- concurrentes leen el mismo "último evento" y las dos pasan por acá; la que pierde
  -- muere en `corrective_action_event_position_uq`. El trigger es la barrera de
  -- CORRECCIÓN y el único es la de CONCURRENCIA. Escribirlo así, en vez de tomar un
  -- `SELECT ... FOR UPDATE` sobre la acción, evita un lock de fila en el camino feliz
  -- para un conflicto que con 15-20 usuarios no va a ocurrir nunca.
  IF NEW.from_state IS DISTINCT FROM last_state THEN
    RAISE EXCEPTION
      'action % is in state %, not %', NEW.action_id, coalesce(last_state, '(none)'),
      coalesce(NEW.from_state, '(none)')
      USING ERRCODE = 'HS004',
            HINT = 'An event applies to the current state of its action.';
  END IF;

  -- La posición es "la última + 1", sin huecos. Sin esto, el único seguiría impidiendo
  -- dos eventos en la misma posición pero no que alguien inserte la posición 99 y deje
  -- un stream con agujeros, donde "el último evento" pasa a ser una cuestión de suerte.
  IF NEW.position IS DISTINCT FROM coalesce(last_position + 1, 0) THEN
    RAISE EXCEPTION
      'action % expects position %, got %',
      NEW.action_id, coalesce(last_position + 1, 0), NEW.position
      USING ERRCODE = 'HS004',
            HINT = 'The stream of an action has no gaps.';
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
            HINT = 'The state machine of a corrective action has five transitions.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_event_transition_guard
  BEFORE INSERT ON corrective_action_event
  FOR EACH ROW EXECUTE FUNCTION hs_action_transition_guard();

--> statement-breakpoint

-- §3 R3: "Una persona distinta del ejecutor la verifica y la cierra."
--
-- SE COMPARA CONTRA EL AUTOR DEL EVENTO DE COMPLETADO, NO CONTRA `assignee_person_id`,
-- y la diferencia no es teórica: el ejecutor real es quien declaró el trabajo hecho, y
-- puede ser el coordinador actuando en nombre de una persona del roster sin cuenta. Si
-- comparáramos contra la persona asignada, ese coordinador podría verificarse a sí
-- mismo — que es exactamente lo que R3 prohíbe.
CREATE OR REPLACE FUNCTION hs_action_verifier_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  executor uuid;
BEGIN
  IF NEW.from_state IS DISTINCT FROM 'awaiting_verification' THEN
    RETURN NEW;
  END IF;

  SELECT e.actor_user_id INTO executor
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
     AND e.to_state = 'awaiting_verification'
   ORDER BY e.position DESC
   LIMIT 1;

  IF executor = NEW.actor_user_id THEN
    RAISE EXCEPTION
      'user % declared action % done and cannot verify it', NEW.actor_user_id, NEW.action_id
      USING ERRCODE = 'HS005',
            HINT = 'A corrective action is verified by someone other than whoever did the work.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_event_verifier_guard
  BEFORE INSERT ON corrective_action_event
  FOR EACH ROW EXECUTE FUNCTION hs_action_verifier_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. "UNA ACCIÓN SIN EVENTOS NO EXISTE", como restricción diferida.
--
-- Es lo que hace que "el estado es una consulta" no tenga el caso degenerado de la
-- consulta que no devuelve nada. Un trigger BEFORE INSERT sobre `corrective_action`
-- correría antes de que el evento exista —el evento necesita el `action_id`—, así que
-- la pregunta solo tiene sentido al commit. Mismo mecanismo que la foto obligatoria del
-- hallazgo en 0010.
CREATE OR REPLACE FUNCTION hs_action_first_event_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM corrective_action_event e WHERE e.action_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'corrective action % has no event', NEW.id
      USING ERRCODE = 'HS007',
            HINT = 'The state of an action is derived from its events; it must have one.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER corrective_action_first_event_required
  AFTER INSERT ON corrective_action
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_action_first_event_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. `corrective_action_evidence` — el antes y el después de R3.
--
-- LA EVIDENCIA CUELGA DEL EVENTO, NO DE LA ACCIÓN. Sin `event_id`, "las fotos del
-- cierre" y "las fotos que alguien subió después" serían indistinguibles, y una acción
-- rechazada y re-completada tendría dos juegos de evidencia mezclados en una bolsa.
--
-- ADR-001 y ADR-006: object keys, nunca bytes. Lo que se guarda es dónde está el
-- archivo, y el prefijo `{site_id}/actions/{action_id}/` lo deriva el servidor.
CREATE TABLE corrective_action_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id uuid NOT NULL REFERENCES corrective_action_event (id),
  action_id uuid NOT NULL REFERENCES corrective_action (id),
  site_id uuid NOT NULL REFERENCES site (id),

  kind text NOT NULL CHECK (kind IN ('before', 'after')),

  object_key text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- La misma key dos veces en el mismo evento es un doble clic, no dos evidencias.
  CONSTRAINT corrective_action_evidence_key_uq UNIQUE (event_id, object_key),

  FOREIGN KEY (event_id, site_id) REFERENCES corrective_action_event (id, site_id),
  FOREIGN KEY (action_id, site_id) REFERENCES corrective_action (id, site_id)
);

--> statement-breakpoint

-- "DECLARAR EL TRABAJO HECHO EXIGE EVIDENCIA", como restricción diferida.
--
-- Diferida por lo mismo que la anterior: la evidencia necesita el `event_id`, así que
-- el orden natural es evento primero y evidencia después, y al commit es el único
-- momento en que la pregunta tiene respuesta. Permite ese orden y sigue haciendo
-- imposible mandar a verificar una acción sin nada que verificar, por cualquier camino.
--
-- Solo evidencia `after`: la de `before` es bienvenida y no es obligatoria, porque no
-- siempre hay un antes que fotografiar y exigirlo produciría fotos de relleno.
CREATE OR REPLACE FUNCTION hs_action_evidence_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.to_state IS DISTINCT FROM 'awaiting_verification' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM corrective_action_evidence ev
     WHERE ev.event_id = NEW.id AND ev.kind = 'after'
  ) THEN
    RAISE EXCEPTION
      'event % declares action % done without evidence', NEW.id, NEW.action_id
      USING ERRCODE = 'HS006',
            HINT = 'Declaring the work done carries at least one `after` evidence.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER corrective_action_evidence_required
  AFTER INSERT ON corrective_action_event
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_action_evidence_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. `corrective_action_escalation` — +3 al supervisor, +7 a gerencia (§3 R3, ADR-005).
--
-- UNA FILA POR ACCIÓN Y NIVEL, Y EL ÚNICO ES LA IDEMPOTENCIA DEL CRON. El trabajo corre
-- todos los días —diario y no "cuando venza", por lo mismo que la apertura de período:
-- un cron que corre el día que el servidor está caído pierde el evento y nadie se
-- entera—. Sobre una acción vencida hace 30 días corre 30 veces y escala una sola, no
-- porque el handler lleve la cuenta sino porque el segundo INSERT no entra.
--
-- Guardar `due_at` y `days_overdue` en la fila, en vez de recalcularlos al leer, es lo
-- que hace que el registro diga cuán tarde era CUANDO SE ESCALÓ y no cuán tarde es hoy.
CREATE TABLE corrective_action_escalation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  action_id uuid NOT NULL REFERENCES corrective_action (id),
  site_id uuid NOT NULL REFERENCES site (id),

  level text NOT NULL CHECK (level IN ('supervisor', 'management')),

  due_at timestamptz NOT NULL,
  days_overdue integer NOT NULL CHECK (days_overdue >= 0),

  escalated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT corrective_action_escalation_level_uq UNIQUE (action_id, level),

  FOREIGN KEY (action_id, site_id) REFERENCES corrective_action (id, site_id)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Los índices.

-- EL `DISTINCT ON` DEL ESTADO VIGENTE (ADR-002) NO LLEVA ÍNDICE PROPIO, y conviene que
-- quede escrito para que nadie lo agregue después creyendo que falta:
-- `corrective_action_event_position_uq` ya es un índice sobre (action_id, position), y
-- Postgres lo recorre hacia atrás sin costo para resolver `ORDER BY position DESC`. Un
-- segundo índice sobre las mismas dos columnas sería mantenimiento en cada INSERT a
-- cambio de nada.

-- La barrida diaria del cron: las acciones de un sitio ordenadas por vencimiento.
CREATE INDEX corrective_action_due_idx
  ON corrective_action (site_id, due_at);

--> statement-breakpoint

-- "Las acciones de este hallazgo", que es cómo se lee un hallazgo en la UI.
CREATE INDEX corrective_action_finding_idx
  ON corrective_action (finding_id);

--> statement-breakpoint

-- "Lo que me toca a mí": la bandeja del responsable.
CREATE INDEX corrective_action_assignee_idx
  ON corrective_action (site_id, assignee_person_id);

--> statement-breakpoint

-- La evidencia de un evento, que se lee siempre junto con el stream.
CREATE INDEX corrective_action_evidence_event_idx
  ON corrective_action_evidence (event_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. La auditoría.
--
-- CUATRO ESLABONES: la acción que nace, cada transición, cada evidencia y cada
-- escalamiento. Escritos por trigger y no por el servicio, por lo mismo que en 0010: un
-- INSERT que no pasó por el endpoint deja su eslabón igual.
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
      'severity', NEW.severity,
      'due_at', NEW.due_at,
      'remediation_group_id', NEW.remediation_group_id,
      'created_by', NEW.created_by),
    NEW.created_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_audit
  AFTER INSERT ON corrective_action
  FOR EACH ROW EXECUTE FUNCTION hs_action_audit();

--> statement-breakpoint

-- Cada paso, con quién lo dio. En el evento de cierre ese `actor_user_id` es el
-- verificador y nunca el ejecutor — la guarda de §3 lo garantiza, y la cadena lo prueba.
CREATE OR REPLACE FUNCTION hs_action_event_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.transitioned',
    jsonb_build_object(
      'action_id', NEW.action_id,
      'event_id', NEW.id,
      'site_id', NEW.site_id,
      'position', NEW.position,
      'from_state', NEW.from_state,
      'to_state', NEW.to_state,
      'actor_user_id', NEW.actor_user_id,
      'reason', NEW.reason),
    NEW.occurred_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_event_audit
  AFTER INSERT ON corrective_action_event
  FOR EACH ROW EXECUTE FUNCTION hs_action_event_audit();

--> statement-breakpoint

-- La evidencia deja su eslabón con la KEY y nunca con el archivo. A diferencia de las
-- fotos del hallazgo —que no dejan entrada propia—, acá sí: la evidencia es lo que
-- sostiene un cierre, y qué archivo se presentó como prueba es parte del hecho.
CREATE OR REPLACE FUNCTION hs_action_evidence_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.evidence_added',
    jsonb_build_object(
      'action_id', NEW.action_id,
      'event_id', NEW.event_id,
      'evidence_id', NEW.id,
      'site_id', NEW.site_id,
      'kind', NEW.kind,
      'object_key', NEW.object_key),
    NEW.created_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_evidence_audit
  AFTER INSERT ON corrective_action_evidence
  FOR EACH ROW EXECUTE FUNCTION hs_action_evidence_audit();

--> statement-breakpoint

-- EL ESCALAMIENTO NO TIENE AUTOR, y eso no es una omisión: es el acto del planificador
-- y no de una persona. `hs_audit_entry_at` toma el actor de `app.user_id`, que el cron
-- no setea, así que `actor_user_id` queda en NULL — el mismo camino que ya usan los
-- eventos sin autor de 0002. La entrada se encadena igual que cualquier otra.
CREATE OR REPLACE FUNCTION hs_action_escalation_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'action.escalated',
    jsonb_build_object(
      'action_id', NEW.action_id,
      'escalation_id', NEW.id,
      'site_id', NEW.site_id,
      'level', NEW.level,
      'due_at', NEW.due_at,
      'days_overdue', NEW.days_overdue),
    NEW.escalated_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER corrective_action_escalation_audit
  AFTER INSERT ON corrective_action_escalation
  FOR EACH ROW EXECUTE FUNCTION hs_action_escalation_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Inmutabilidad y aislamiento.
SELECT hs_make_immutable('corrective_action');

--> statement-breakpoint

SELECT hs_make_immutable('corrective_action_event');

--> statement-breakpoint

SELECT hs_make_immutable('corrective_action_evidence');

--> statement-breakpoint

SELECT hs_make_immutable('corrective_action_escalation');

--> statement-breakpoint

SELECT hs_apply_site_isolation('corrective_action');

--> statement-breakpoint

SELECT hs_apply_site_isolation('corrective_action_event');

--> statement-breakpoint

SELECT hs_apply_site_isolation('corrective_action_evidence');

--> statement-breakpoint

SELECT hs_apply_site_isolation('corrective_action_escalation');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA
-- MIGRACIÓN, Y ESA AUSENCIA ES EL REQUISITO — igual que en 0009 y 0010.
--
-- La tentación acá es la más fuerte de las tres: avanzar una acción *parece* un UPDATE
-- de una columna `status`, reasignarla *parece* un UPDATE de `assignee_person_id`, y
-- correr un plazo *parece* un UPDATE de `due_at`. Ninguna de las tres lo es. La primera
-- es un evento nuevo; las otras dos no existen — una obligación que se puede reasignar
-- o posponer en silencio no es un registro de nada.
GRANT SELECT, INSERT ON
  corrective_action,
  corrective_action_event,
  corrective_action_evidence,
  corrective_action_escalation
  TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 11. La bandeja gana tres tipos de notificación.
--
-- La asignación y los dos escalamientos. `notification.kind` es una lista cerrada desde
-- 0008 y ampliarla exige esta migración a propósito: el comentario de 0008 dice que "el
-- consumidor tiene que saber leer el payload, así que un tipo nuevo no puede aparecer
-- sin que alguien escriba cómo se muestra". Esto es esa cuenta, cobrada por primera vez.
--
-- DOS `kind` PARA LOS ESCALAMIENTOS Y NO UNO CON UN CAMPO `level`: quién recibe cada
-- escalón es la decisión de R3, y un solo tipo haría que la bandeja del supervisor y la
-- de gerencia se distingan por el contenido en vez de por el destinatario.
--
-- Del lado de TypeScript, la misma lista es la unión discriminada de
-- `packages/contracts/src/notifications.ts`, que además fija la forma del payload de
-- cada uno — cosa que este `CHECK` no puede hacer.
ALTER TABLE notification
  DROP CONSTRAINT notification_kind_check;

--> statement-breakpoint

ALTER TABLE notification
  ADD CONSTRAINT notification_kind_check CHECK (kind IN (
    'inspection_period_opened',
    'corrective_action_assigned',
    'corrective_action_overdue_supervisor',
    'corrective_action_overdue_management'));
