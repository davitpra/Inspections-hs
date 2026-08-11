-- Requisitos §4 (Incidente, Investigación), §3 R4, y §7 etapa 6 — EL INCIDENTE.
--
-- 0011 dejó el motor de estados construido y probado con un solo consumidor, y dejó
-- escrito que el segundo llegaría acá con su propia guarda. Esta migración crea el
-- incidente en tercera persona —un supervisor lo carga sobre una Persona del roster que
-- casi seguro no tiene cuenta—, su investigación con causa raíz, y la guarda que da
-- sentido a toda la máquina: un incidente no se cierra con acciones correctivas
-- abiertas.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   El estado de un incidente NO es una columna                   ausencia de columna (§1)
--   Los relojes regulatorios NO son columnas                      ausencia de columna (§1)
--   No existe la clasificación `near_miss`                        CHECK de dominio (§1)
--   No hay ningún campo de detalle clínico                        ausencia de columna (§1)
--   El evento no puede ser posterior al reporte                   CHECK de orden (§1)
--   Un incidente sin evento de reporte no llega a existir         trigger diferido (§6)
--   Solo las 5 transiciones de la máquina son posibles            trigger de guarda (§6)
--   Dos transiciones simultáneas no bifurcan el stream            único (incident, position) (§2)
--   Tres clasificaciones no pueden cerrarse sin investigar        trigger de guarda (§6)
--   Un incidente no cierra con acciones abiertas                  trigger de guarda (§6)
--   Un incidente no cierra sin causa raíz                         trigger de guarda (§6)
--   Un incidente en investigación tiene su investigación          trigger diferido (§6)
--   Una acción correctiva tiene exactamente un padre              CHECK de exactamente-una (§5)
--   Cada reporte, transición, apertura y causa se encadena        triggers (§7)
--   Nadie modifica ni borra nada de esto                          hs_make_immutable (§8)
--   Nadie ve los incidentes de la otra planta                     hs_apply_site_isolation (§8)
--   Un supervisor no ve el incidente de otro supervisor           política RESTRICTIVE (§8)
--
-- LO QUE ESTA MIGRACIÓN NO HACE, y es deliberado:
--
--   NO calcula ningún plazo regulatorio. Los calcula `regulatoryClocks()` de
--   `@hs/contracts` al leer, y NO se guardan. Sus tres entradas —clasificación,
--   `occurred_at` y `reported_at`— viven congeladas en una fila append-only, así que la
--   función devuelve lo mismo cada vez que se la llama y una columna solo agregaría una
--   copia que puede quedar desactualizada. Es la misma razón por la que no hay columna
--   `status`, aplicada a un segundo dato derivado (ADR-008).
--
--   NO tiene columna de estado en `incident`, y esa ausencia es el requisito (ADR-002).
--
--   NO tiene `near_miss` entre las clasificaciones. La pregunta cerrada 8 y el riesgo F
--   lo sacaron: el casi-accidente se carga como hallazgo de entrada manual, que es
--   donde tiene consecuencias.
--
--   NO tiene NINGUNA columna de detalle clínico —diagnóstico, parte médico,
--   restricción funcional, naturaleza de la lesión—, y eso es una PROHIBICIÓN, no un
--   recorte de alcance. `body_part` es una categoría gruesa y es el límite (§4, riesgo
--   G-bis). La entidad `DetalleMédico` fue eliminada del alcance. Tampoco hay tabla de
--   fotos: la foto de una persona accidentada es detalle clínico por otra puerta.
--
--   NO envía nada al MLITSD ni al WSIB, y no hay columna que registre que se envió: el
--   sistema no vio el envío y no lo va a inventar (§3 R4).
--
-- SÍ ALTERA UNA TABLA INMUTABLE, y es el ALTER que 0011 dejó anotado (§5). §4 dice que
-- una acción correctiva pertenece a exactamente un padre, que es un `Hallazgo` **o** una
-- `Investigación`. `investigation` ya existe cuando se llega a ese punto de este
-- archivo, así que acá se agrega `investigation_id`, se relaja el `NOT NULL` de
-- `finding_id` y entra el CHECK de exactamente-una. Es DDL del rol dueño sobre una tabla
-- inmutable, que está permitido: LA INMUTABILIDAD ES SOBRE LAS FILAS, NO SOBRE EL
-- ESQUEMA. No se reescribe ninguna fila: las que existen tienen `finding_id` y un
-- `investigation_id` nulo, que es exactamente lo que el CHECK nuevo exige.
--
-- SÍ ALTERA UNA TABLA MUTABLE: el `CHECK` de `notification.kind`, para admitir
-- `incident_reported` (§10). Misma cuenta que 0011 pagó por sus tres tipos.

-- ---------------------------------------------------------------------------
-- 1. `incident` — el hecho, congelado.
--
-- §3 R4: "Un supervisor o gerente entra a la plataforma, selecciona a la persona
-- afectada de una lista sin poder ver su perfil, clasifica el evento, y describe qué
-- pasó."
CREATE TABLE incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- LA VERSIÓN DEL FORMULARIO CON LA QUE SE ESCRIBIÓ ESTA FILA (pregunta cerrada 10).
  --
  -- No es metadato decorativo: es lo que hace que "vacío porque no aplicaba" y "vacío
  -- porque el campo no existía" sigan siendo distinguibles dentro de diez años. En
  -- código vive `INCIDENT_FORM_VERSIONS`, el registro `versión → conjunto de campos`,
  -- y la lectura devuelve qué campos tenía ESTA versión. En un registro inmutable esa
  -- diferencia no se puede reconstruir después, así que se guarda ahora o se pierde.
  form_version integer NOT NULL CHECK (form_version >= 1),

  -- LAS CINCO CLASIFICACIONES DE §4, Y NO HAY UNA SEXTA.
  --
  -- `near_miss` NO ESTÁ Y ESA AUSENCIA ES EL REQUISITO (pregunta cerrada 8, riesgo F):
  -- con reporte en tercera persona por personal de supervisión el indicador iba a ser
  -- cercano a cero, y "no hay casi-accidentes" y "no hay reporte de casi-accidentes" se
  -- ven idénticos en un dashboard. El evento tiene dónde vivir: hallazgo manual.
  --
  -- La misma lista es `INCIDENT_CLASSIFICATIONS` en `@hs/contracts` y un test de
  -- integración las compara, igual que `RESPONSE_TYPES` en 0007.
  --
  -- SE CONGELA AL REPORTAR. La tabla es inmutable, así que reclasificar no existe. El
  -- costo está declarado en el diseño (D4): un evento de primeros auxilios que a los
  -- tres días se vuelve tiempo perdido dispara una obligación que este sistema no va a
  -- mostrar. La respuesta es `RegistroSuplementario` de §4, que todavía no existe.
  classification text NOT NULL CHECK (classification IN (
    'first_aid',
    'health_care',
    'lost_time_or_modified_work',
    'critical_injury',
    'occupational_illness')),

  -- EL SUJETO ES UNA PERSONA; EL REPORTANTE ES UNA CUENTA. Es la distinción central de
  -- §4 en su caso más visible: el supervisor elige a la persona afectada sin que eso
  -- implique darle acceso al sistema, y sin poder ver su perfil.
  --
  -- Referencia a `person (id)` a secas, sin par con el sitio, por lo mismo que 0011:
  -- `person.site_id` es mutable y congelar el par haría que una transferencia entre
  -- plantas invalide retroactivamente los registros que nombran a esa persona. Que el
  -- sujeto sea del sitio se comprueba al reportar y lo garantiza la RLS de `person`.
  subject_person_id uuid NOT NULL REFERENCES person (id),

  reported_by uuid NOT NULL REFERENCES app_user (id),

  -- LOS DOS INSTANTES, Y LA DIFERENCIA ENTRE ELLOS ES EL DISEÑO (D5).
  --
  -- Los plazos del MLITSD por una lesión cuentan desde que OCURRIÓ; el del WSIB y el de
  -- la enfermedad ocupacional cuentan desde que el empleador SE ENTERÓ, que acá es
  -- `reported_at`. Un solo instante para los dos daría un Form 7 vencido antes de
  -- existir cada vez que alguien carga un accidente de la semana pasada.
  occurred_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),

  -- La misma lista cerrada que usan los hallazgos (pregunta cerrada 1): el vocabulario
  -- de ubicación es uno solo en todo el sistema, o los reportes no se pueden cruzar.
  location_id uuid NOT NULL REFERENCES location (id),

  -- LOS CAMPOS GUIADOS DE §4. No hay un cuadro de texto libre único, y esa ausencia es
  -- el requisito: "un campo corto y concreto es mucho más fácil de completar bien para
  -- quien no escribe cómodo en inglés que un cuadro que dice «describa el incidente»".
  task_performed text NOT NULL,
  equipment_involved text NOT NULL,
  what_happened text NOT NULL,

  -- CATEGORÍA GRUESA, NO DIAGNÓSTICO, y acá está el límite del que habla §4. No hay
  -- —ni va a haber— columna de naturaleza de la lesión, de parte médico ni de
  -- restricción funcional. Nadie, ni el coordinador de HS, puede consultar en este
  -- sistema qué lesión tuvo una persona: solo en qué categoría cayó el evento.
  body_part text NOT NULL CHECK (body_part IN (
    'head', 'eye', 'face', 'neck', 'shoulder', 'arm_or_elbow', 'hand_or_finger',
    'back', 'torso', 'hip_or_groin', 'leg_or_knee', 'foot_or_toe',
    'multiple', 'not_applicable')),

  -- Lo que se hizo EN LA PLANTA, no lo que un clínico concluyó después.
  on_site_treatment text NOT NULL CHECK (on_site_treatment IN (
    'none', 'first_aid_on_site', 'sent_to_clinic', 'sent_to_hospital',
    'emergency_services_called', 'sent_home')),

  immediate_action text NOT NULL,

  -- EL IDIOMA EN QUE SE ESCRIBIÓ, no una preferencia de interfaz (riesgo G). Si un
  -- supervisor hispanohablante escribe en español, el registro conserva sus palabras
  -- exactas y anota cuál era el idioma. NO HAY TRADUCCIÓN AUTOMÁTICA dentro de un
  -- registro inmutable, y esa prohibición es del riesgo G.
  narrative_language text NOT NULL CHECK (narrative_language IN ('en', 'es')),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Mismos mínimos que `reportIncidentRequestSchema`: el contrato los rechaza antes para
  -- devolver un error legible, esto los rechaza igual por cualquier otro camino.
  CONSTRAINT incident_task_performed_check CHECK (char_length(task_performed) >= 3),
  CONSTRAINT incident_equipment_check CHECK (char_length(equipment_involved) >= 3),
  CONSTRAINT incident_what_happened_check CHECK (char_length(what_happened) >= 3),
  CONSTRAINT incident_immediate_action_check CHECK (char_length(immediate_action) >= 3),

  -- Un evento no puede haber ocurrido después de haber sido reportado. Sin esto, un
  -- `occurred_at` en el futuro correría los plazos del MLITSD hacia adelante y el
  -- sistema mostraría un plazo que la ley no da.
  CONSTRAINT incident_occurred_before_reported_check CHECK (occurred_at <= reported_at),

  -- El incidente y su ubicación son de la misma planta. El orden de las columnas es el
  -- de `location_site_id_uq` (0004), igual que en 0010.
  FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)
);

--> statement-breakpoint

-- NO HAY COLUMNA DE ESTADO NI DE PLAZO, Y ESAS DOS AUSENCIAS SON EL REQUISITO.
--
-- El estado vigente es `DISTINCT ON (incident_id) ... ORDER BY position DESC` sobre
-- `incident_event`, igual que en 0011. Los relojes son `regulatoryClocks()` sobre tres
-- columnas congeladas. Buscar acá un `status` o un `wsib_due_at` es buscar lo que el
-- diseño decidió no tener.

-- El destino de las FK compuestas de las tablas hijas.
ALTER TABLE incident
  ADD CONSTRAINT incident_id_site_uq UNIQUE (id, site_id);

--> statement-breakpoint

CREATE INDEX incident_site_reported_idx ON incident (site_id, reported_at DESC);

--> statement-breakpoint

CREATE INDEX incident_reporter_idx ON incident (site_id, reported_by);

--> statement-breakpoint

-- Para la etapa 7: agrupar por clasificación, por equipo y por tarea. Las consultas no
-- se escriben acá; el índice queda para que cuando se escriban no haya que migrar.
CREATE INDEX incident_classification_idx ON incident (site_id, classification, occurred_at);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `incident_event` — el stream.
--
-- §4: los estados del incidente son "un stream de eventos, con el mismo motor que la
-- acción correctiva". Mismo motor quiere decir mismo diseño, no código compartido: dos
-- tablas de transiciones separadas, cada una con sus guardas. Con dos consumidores no
-- se extrae la abstracción; se extrae cuando el tercero diga cuál es.
CREATE TABLE incident_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  incident_id uuid NOT NULL REFERENCES incident (id),
  site_id uuid NOT NULL REFERENCES site (id),

  -- El orden dentro del incidente, por lo mismo que en 0011: un bigserial global ordena
  -- pero no protege, y el único de más abajo es lo que impide que dos transiciones
  -- simultáneas partan del mismo estado y bifurquen el stream.
  position integer NOT NULL,

  -- Nulo solo en el evento de reporte.
  from_state text CHECK (from_state IN ('reported', 'under_investigation', 'closed')),
  to_state text NOT NULL CHECK (to_state IN ('reported', 'under_investigation', 'closed')),

  -- Una CUENTA. `incident.subject_person_id` es una PERSONA. Son dos hechos distintos:
  -- de quién es el cuerpo y quién tocó el sistema.
  actor_user_id uuid NOT NULL REFERENCES app_user (id),

  note text,

  -- Obligatorio al cerrar sin investigar y al reabrir. La guarda de §3 lo exige por
  -- transición; este CHECK solo garantiza que si viene, diga algo.
  reason text CHECK (reason IS NULL OR char_length(reason) >= 10),

  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),

  -- LA DEFENSA CONTRA LA BIFURCACIÓN, y a la vez el índice que resuelve el DISTINCT ON
  -- del estado vigente leído al revés.
  CONSTRAINT incident_event_position_uq UNIQUE (incident_id, position),

  FOREIGN KEY (incident_id, site_id) REFERENCES incident (id, site_id)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `incident_witness` — los testigos.
--
-- Referencias a Persona por el mismo selector que el sujeto, y por la misma razón: §4
-- dice "reutiliza el selector sin ver perfiles". Un testigo no gana cuenta, no recibe
-- notificación y no se entera de que fue nombrado.
CREATE TABLE incident_witness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  incident_id uuid NOT NULL REFERENCES incident (id),
  site_id uuid NOT NULL REFERENCES site (id),
  person_id uuid NOT NULL REFERENCES person (id),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- La misma persona no se nombra dos veces como testigo del mismo incidente.
  CONSTRAINT incident_witness_person_uq UNIQUE (incident_id, person_id),

  FOREIGN KEY (incident_id, site_id) REFERENCES incident (id, site_id)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `investigation` e `investigation_cause` — la causa raíz.
--
-- §4: "Investigación — causa raíz estructurada (5 porqués o árbol), testigos, secuencia
-- de eventos. Sus acciones correctivas usan el mismo motor que las de inspección."
CREATE TABLE investigation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNA POR INCIDENTE. El único es lo que lo garantiza.
  incident_id uuid NOT NULL UNIQUE REFERENCES incident (id),
  site_id uuid NOT NULL REFERENCES site (id),

  -- EL MÉTODO SE REGISTRA, NO SE INFIERE. Deducirlo de la forma del grafo —cadena es
  -- cinco porqués, ramas es árbol— sería adivinar: un árbol con una sola rama cargada
  -- es indistinguible de una cadena, y el registro diría que se usó un método que nadie
  -- usó.
  method text NOT NULL CHECK (method IN ('five_whys', 'cause_tree')),

  sequence_of_events text,

  opened_by uuid NOT NULL REFERENCES app_user (id),
  opened_at timestamptz NOT NULL DEFAULT now(),

  -- Destino de las FK compuestas de las causas y de `corrective_action`.
  CONSTRAINT investigation_id_site_uq UNIQUE (id, site_id),

  FOREIGN KEY (incident_id, site_id) REFERENCES incident (id, site_id)
);

--> statement-breakpoint

-- UNA SOLA TABLA PARA LOS CINCO PORQUÉS Y PARA EL ÁRBOL (design D8): el árbol es la
-- lista con padres, y los cinco porqués son el árbol degenerado en cadena.
--
-- NO ES UN JSON CON EL ÁRBOL ENTERO. Se leería más fácil y se auditaría peor: cada
-- causa dejaría de tener su propia entrada en la cadena de hashes, y "se agregó una
-- causa" y "se reescribió el árbol" serían indistinguibles en una tabla donde UPDATE
-- está revocado justamente para que no lo sean.
CREATE TABLE investigation_cause (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  investigation_id uuid NOT NULL REFERENCES investigation (id),
  site_id uuid NOT NULL REFERENCES site (id),

  position integer NOT NULL,

  statement text NOT NULL,

  -- Cuál cierra el análisis. Sin al menos una, el incidente no se cierra.
  is_root boolean NOT NULL DEFAULT false,

  -- La rama del árbol. Nulo en la cadena de los cinco porqués y en la primera causa.
  parent_cause_id uuid REFERENCES investigation_cause (id),

  recorded_by uuid NOT NULL REFERENCES app_user (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT investigation_cause_statement_check CHECK (char_length(statement) >= 10),
  CONSTRAINT investigation_cause_position_uq UNIQUE (investigation_id, position),

  FOREIGN KEY (investigation_id, site_id) REFERENCES investigation (id, site_id)
);

--> statement-breakpoint

-- Un incidente en investigación tiene su investigación, comprobado al commit por lo
-- mismo que el primer evento: el evento de transición y la fila de `investigation` se
-- insertan en la misma transacción y ninguno de los dos puede ir primero sin el otro.
CREATE OR REPLACE FUNCTION hs_incident_investigation_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.to_state IS DISTINCT FROM 'under_investigation' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM investigation i WHERE i.incident_id = NEW.incident_id
  ) THEN
    RAISE EXCEPTION
      'incident % is under investigation with no investigation row', NEW.incident_id
      USING ERRCODE = 'HS012',
            HINT = 'Moving an incident to investigation opens its investigation.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER incident_investigation_required
  AFTER INSERT ON incident_event
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_incident_investigation_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. El segundo padre de la acción correctiva.
--
-- EL ALTER QUE 0011 DEJÓ ANOTADO. §4: "Una acción correctiva pertenece a exactamente un
-- padre, que es un `Hallazgo` o una `Investigación`. Se modela con dos claves foráneas
-- nullable y un CHECK que exige que haya una y solo una."
--
-- BREAKING para cualquier consulta que asuma `finding_id IS NOT NULL`.
--
-- NO SE REESCRIBE NINGUNA FILA. `ADD COLUMN` de una columna nullable y `DROP NOT NULL`
-- son cambios de catálogo en Postgres moderno; el único que escanea la tabla es el
-- CHECK, y por eso entra como NOT VALID y se valida en un segundo paso, que es el patrón
-- que no toma un lock largo. El VALIDATE va en la misma migración para que no exista un
-- despliegue con la restricción sin validar.
ALTER TABLE corrective_action
  ADD COLUMN investigation_id uuid REFERENCES investigation (id);

--> statement-breakpoint

ALTER TABLE corrective_action
  ADD CONSTRAINT corrective_action_investigation_site_fk
  FOREIGN KEY (investigation_id, site_id) REFERENCES investigation (id, site_id);

--> statement-breakpoint

ALTER TABLE corrective_action
  ALTER COLUMN finding_id DROP NOT NULL;

--> statement-breakpoint

-- EXACTAMENTE UNO. Ni ninguno —una obligación sin padre no se puede rastrear hasta el
-- hecho que la originó— ni los dos, que dejaría sin respuesta de dónde salió la
-- severidad del plazo.
ALTER TABLE corrective_action
  ADD CONSTRAINT corrective_action_one_parent_check
  CHECK (num_nonnulls(finding_id, investigation_id) = 1) NOT VALID;

--> statement-breakpoint

ALTER TABLE corrective_action
  VALIDATE CONSTRAINT corrective_action_one_parent_check;

--> statement-breakpoint

CREATE INDEX corrective_action_investigation_idx ON corrective_action (investigation_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Las guardas de la máquina de estados.

-- La consulta del estado vigente de una acción correctiva, escrita una sola vez.
--
-- ESTA FUNCIÓN ES LA RAZÓN DE SER DE LA ETAPA 6 (design D1). Es la primera guarda del
-- sistema que no es local a la fila que se inserta: para saber si un incidente puede
-- cerrarse hay que recorrer el stream de eventos de cada una de sus acciones. Un CHECK
-- no puede consultar otra tabla, y un contador desnormalizado en `incident` sería una
-- columna que hay que mantener con UPDATE sobre una tabla que no lo tiene.
--
-- `STABLE` y de solo lectura: no toma locks de escritura sobre `corrective_action`, así
-- que no puede formar un deadlock con quien esté cerrando una acción. Cuesta un índice
-- y unas pocas filas — una investigación tiene unidades de acciones, no miles.
CREATE OR REPLACE FUNCTION hs_incident_has_open_actions(target_incident uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM corrective_action a
      JOIN investigation i ON i.id = a.investigation_id
      LEFT JOIN LATERAL (
        SELECT e.to_state
          FROM corrective_action_event e
         WHERE e.action_id = a.id
         ORDER BY e.position DESC
         LIMIT 1
      ) current_state ON true
     WHERE i.incident_id = target_incident
       AND current_state.to_state IS DISTINCT FROM 'closed'
  );
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_incident_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  last_state text;
  last_position integer;
  incident_classification text;
BEGIN
  SELECT e.to_state, e.position INTO last_state, last_position
    FROM incident_event e
   WHERE e.incident_id = NEW.incident_id
   ORDER BY e.position DESC
   LIMIT 1;

  -- Igual que en 0011: esta guarda es la barrera de CORRECCIÓN y el único
  -- `(incident_id, position)` es la de CONCURRENCIA. Las dos transacciones concurrentes
  -- pasan por acá; la que pierde muere en el único.
  IF NEW.from_state IS DISTINCT FROM last_state THEN
    RAISE EXCEPTION
      'incident % is in state %, not %', NEW.incident_id, coalesce(last_state, '(none)'),
      coalesce(NEW.from_state, '(none)')
      USING ERRCODE = 'HS008',
            HINT = 'An event applies to the current state of its incident.';
  END IF;

  IF NEW.position IS DISTINCT FROM coalesce(last_position + 1, 0) THEN
    RAISE EXCEPTION
      'incident % expects position %, got %',
      NEW.incident_id, coalesce(last_position + 1, 0), NEW.position
      USING ERRCODE = 'HS008',
            HINT = 'The stream of an incident has no gaps.';
  END IF;

  -- LA MISMA TABLA QUE `INCIDENT_TRANSITIONS` EN `@hs/contracts`, escrita otra vez.
  -- SQL no puede importar TypeScript; la duplicación es deliberada y un test de
  -- integración evalúa todos los pares ordenados por los dos caminos y los compara.
  IF NOT EXISTS (
    SELECT 1
      FROM (VALUES
        (NULL,                  'reported'),
        ('reported',            'under_investigation'),
        ('reported',            'closed'),
        ('under_investigation', 'closed'),
        ('closed',              'under_investigation')
      ) AS allowed(from_state, to_state)
     WHERE allowed.from_state IS NOT DISTINCT FROM NEW.from_state
       AND allowed.to_state = NEW.to_state
  ) THEN
    RAISE EXCEPTION
      'transition % -> % is not allowed', coalesce(NEW.from_state, '(none)'), NEW.to_state
      USING ERRCODE = 'HS008',
            HINT = 'The state machine of an incident has five transitions.';
  END IF;

  -- El motivo obligatorio, por transición. El CHECK de la tabla garantiza que si viene
  -- diga algo; esto garantiza que venga donde §4 lo exige.
  IF NEW.reason IS NULL AND (
       (NEW.from_state = 'reported' AND NEW.to_state = 'closed')
    OR (NEW.from_state = 'closed' AND NEW.to_state = 'under_investigation')
  ) THEN
    RAISE EXCEPTION
      'transition % -> % of incident % requires a reason',
      NEW.from_state, NEW.to_state, NEW.incident_id
      USING ERRCODE = 'HS008',
            HINT = 'Closing without investigating, and reopening, both state why.';
  END IF;

  IF NEW.to_state = 'closed' THEN
    SELECT i.classification INTO incident_classification
      FROM incident i WHERE i.id = NEW.incident_id;

    -- LA INVESTIGACIÓN OBLIGATORIA DE §4.
    --
    -- La misma lista es `INVESTIGATION_REQUIRED_CLASSIFICATIONS` en `@hs/contracts`, y
    -- §4 dice con todas las letras que HAY QUE CONFIRMARLA contra las obligaciones
    -- concretas del empleador bajo la OHSA antes de producción: el sistema la trata
    -- como configuración en código, no como regla legal autoritativa.
    IF NEW.from_state = 'reported'
       AND incident_classification IN (
         'critical_injury', 'lost_time_or_modified_work', 'occupational_illness') THEN
      RAISE EXCEPTION
        'incident % is classified % and cannot be closed without an investigation',
        NEW.incident_id, incident_classification
        USING ERRCODE = 'HS010',
              HINT = 'Three classifications require an investigation before closing.';
    END IF;

    -- LA CAUSA RAÍZ. §4: "requiere causa raíz registrada y todas sus acciones en
    -- cerrada". Una investigación sin causa raíz es una carpeta vacía con un nombre.
    IF NEW.from_state = 'under_investigation' AND NOT EXISTS (
      SELECT 1
        FROM investigation i
        JOIN investigation_cause c ON c.investigation_id = i.id
       WHERE i.incident_id = NEW.incident_id AND c.is_root
    ) THEN
      RAISE EXCEPTION
        'incident % has no root cause recorded', NEW.incident_id
        USING ERRCODE = 'HS011',
              HINT = 'Closing an investigation requires at least one root cause.';
    END IF;

    -- LA GUARDA QUE DA SENTIDO A LA MÁQUINA (pregunta cerrada 7).
    --
    -- "La decisión clave no es la lista de estados sino la guarda de cierre: un
    -- incidente no puede cerrarse con acciones correctivas abiertas. Eso hace que el
    -- estado del incidente sea una consecuencia del trabajo real y no una declaración
    -- administrativa."
    --
    -- Se evalúa acá dentro y no en el servicio a propósito: dos transacciones
    -- concurrentes —una que cierra la última acción y otra que cierra el incidente—
    -- pasarían las dos por una comprobación de aplicación. Adentro del trigger, la
    -- lectura ocurre en la misma transacción que la inserción del evento de cierre.
    IF hs_incident_has_open_actions(NEW.incident_id) THEN
      RAISE EXCEPTION
        'incident % has corrective actions that are not closed', NEW.incident_id
        USING ERRCODE = 'HS009',
              HINT = 'An incident closes when its corrective actions are closed.';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER incident_event_transition_guard
  BEFORE INSERT ON incident_event
  FOR EACH ROW EXECUTE FUNCTION hs_incident_transition_guard();

--> statement-breakpoint

-- Un incidente sin evento de reporte no existe. Mismo mecanismo y mismo motivo que
-- `corrective_action_first_event_required` en 0011: el estado se deriva de los eventos,
-- así que una fila sin ninguno es una fila cuyo estado es una consulta vacía. Diferido
-- al commit porque el evento necesita el `incident_id` para existir.
CREATE OR REPLACE FUNCTION hs_incident_first_event_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM incident_event e WHERE e.incident_id = NEW.id) THEN
    RAISE EXCEPTION
      'incident % has no event', NEW.id
      USING ERRCODE = 'HS012',
            HINT = 'The state of an incident is derived from its events; it must have one.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER incident_first_event_required
  AFTER INSERT ON incident
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_incident_first_event_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. La auditoría.
--
-- CUATRO ESLABONES: el incidente que se reporta, cada transición, la investigación que
-- se abre y cada causa. Escritos por trigger y no por el servicio: un INSERT que no pasó
-- por el endpoint deja su eslabón igual.
--
-- EL PAYLOAD NO LLEVA NARRATIVA NI NOMBRE, y esa ausencia es deliberada (design D11).
-- `audit_log` se lee bajo una regla de acceso distinta de la del incidente: si el
-- payload llevara `what_happened` o el nombre del sujeto, la política RESTRICTIVE de §8
-- se saltearía por una tabla adyacente. El sujeto se identifica por `subject_person_id`
-- y por nada más.
CREATE OR REPLACE FUNCTION hs_incident_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'incident.reported',
    jsonb_build_object(
      'incident_id', NEW.id,
      'site_id', NEW.site_id,
      'classification', NEW.classification,
      'form_version', NEW.form_version,
      'location_id', NEW.location_id,
      'subject_person_id', NEW.subject_person_id,
      'reported_by', NEW.reported_by,
      'occurred_at', NEW.occurred_at,
      'reported_at', NEW.reported_at,
      'witness_count', (
        SELECT count(*) FROM incident_witness w WHERE w.incident_id = NEW.id)),
    NEW.reported_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- DIFERIDO AL COMMIT, y no un `AFTER INSERT` normal como los otros tres.
--
-- `witness_count` necesita que los testigos ya estén, y los testigos se insertan después
-- del incidente —necesitan su `incident_id`—, así que un trigger de fila inmediato
-- contaría siempre cero. Es el mismo motivo por el que la foto obligatoria del hallazgo
-- y el primer evento de la acción se comprueban al commit: la pregunta solo tiene
-- sentido cuando la transacción terminó de escribir.
--
-- La cadena de hashes no se resiente: `hs_audit_entry_at` la calcula al insertar la
-- entrada, y que eso ocurra al final de la transacción en vez de al principio no cambia
-- ni el orden por sitio ni el encadenado — solo cambia contra qué estado se lee el
-- payload, que es justamente lo que se quiere.
CREATE CONSTRAINT TRIGGER incident_audit
  AFTER INSERT ON incident
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_incident_audit();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_incident_event_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'incident.transitioned',
    jsonb_build_object(
      'incident_id', NEW.incident_id,
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

CREATE TRIGGER incident_event_audit
  AFTER INSERT ON incident_event
  FOR EACH ROW EXECUTE FUNCTION hs_incident_event_audit();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_investigation_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'investigation.opened',
    jsonb_build_object(
      'investigation_id', NEW.id,
      'incident_id', NEW.incident_id,
      'site_id', NEW.site_id,
      'method', NEW.method,
      'opened_by', NEW.opened_by),
    NEW.opened_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER investigation_audit
  AFTER INSERT ON investigation
  FOR EACH ROW EXECUTE FUNCTION hs_investigation_audit();

--> statement-breakpoint

-- SIN EL `statement`, por lo mismo que el incidente va sin narrativa: una causa raíz
-- describe qué pasó y quién falló, y el log se consulta con otra regla de acceso.
CREATE OR REPLACE FUNCTION hs_investigation_cause_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'investigation.cause_recorded',
    jsonb_build_object(
      'investigation_id', NEW.investigation_id,
      'cause_id', NEW.id,
      'site_id', NEW.site_id,
      'position', NEW.position,
      'is_root', NEW.is_root,
      'parent_cause_id', NEW.parent_cause_id,
      'recorded_by', NEW.recorded_by),
    NEW.recorded_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER investigation_cause_audit
  AFTER INSERT ON investigation_cause
  FOR EACH ROW EXECUTE FUNCTION hs_investigation_cause_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Inmutabilidad, aislamiento y la visibilidad angosta.
SELECT hs_make_immutable('incident');

--> statement-breakpoint

SELECT hs_make_immutable('incident_event');

--> statement-breakpoint

SELECT hs_make_immutable('incident_witness');

--> statement-breakpoint

SELECT hs_make_immutable('investigation');

--> statement-breakpoint

SELECT hs_make_immutable('investigation_cause');

--> statement-breakpoint

SELECT hs_apply_site_isolation('incident');

--> statement-breakpoint

SELECT hs_apply_site_isolation('incident_event');

--> statement-breakpoint

SELECT hs_apply_site_isolation('incident_witness');

--> statement-breakpoint

SELECT hs_apply_site_isolation('investigation');

--> statement-breakpoint

SELECT hs_apply_site_isolation('investigation_cause');

--> statement-breakpoint

-- LA VISIBILIDAD ANGOSTA (design D2). §4, tabla de roles: el supervisor "no ve
-- incidentes de otros".
--
-- ES LA PRIMERA POLÍTICA DEL SISTEMA QUE NO ALCANZA CON `site_id`. Un incidente lo ven
-- quien lo cargó, el coordinador de HS y gerencia — y nadie más, ni siquiera otro
-- supervisor de la misma planta.
--
-- POR QUÉ `RESTRICTIVE` Y NO UNA REESCRITURA DE `hs_apply_site_isolation`: Postgres
-- combina las políticas PERMISSIVE con OR y las RESTRICTIVE con AND. La aislación por
-- sitio es permisiva y está probada en diez tablas; tocarla para un caso sería arriesgar
-- las diez por una. Esta se suma y las dos condiciones se componen con AND, que es
-- exactamente la semántica del requisito: sitio Y visibilidad.
--
-- SIN `app.role` EN LA CONEXIÓN LA POLÍTICA NO ENCUENTRA A NADIE, Y ESE ES EL
-- COMPORTAMIENTO DESEADO. Una transacción que no declara rol no ve ningún incidente en
-- vez de verlos todos: el modo de falla es cerrado, así que un olvido se manifiesta como
-- "no veo nada" —que se investiga— y no como "veo de más", que no se nota.
--
-- El `WITH CHECK` cierra el otro lado: nadie inserta un incidente a nombre de otra
-- cuenta.
CREATE POLICY incident_visibility ON incident
  AS RESTRICTIVE
  FOR ALL
  USING (
    reported_by = nullif(current_setting('app.user_id', true), '')::uuid
    OR nullif(current_setting('app.role', true), '') IN ('hs_coordinator', 'management'))
  WITH CHECK (
    reported_by = nullif(current_setting('app.user_id', true), '')::uuid
    OR nullif(current_setting('app.role', true), '') IN ('hs_coordinator', 'management'));

--> statement-breakpoint

-- Las cuatro hijas heredan la visibilidad de su incidente. Se evalúa contra el padre y
-- no se copia `reported_by` a cada tabla: una copia es una copia que puede divergir, y
-- acá divergir significa que un supervisor ve el evento de un incidente que no ve.
CREATE POLICY incident_event_visibility ON incident_event
  AS RESTRICTIVE
  FOR ALL
  USING (EXISTS (SELECT 1 FROM incident i WHERE i.id = incident_event.incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incident i WHERE i.id = incident_event.incident_id));

--> statement-breakpoint

CREATE POLICY incident_witness_visibility ON incident_witness
  AS RESTRICTIVE
  FOR ALL
  USING (EXISTS (SELECT 1 FROM incident i WHERE i.id = incident_witness.incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incident i WHERE i.id = incident_witness.incident_id));

--> statement-breakpoint

CREATE POLICY investigation_visibility ON investigation
  AS RESTRICTIVE
  FOR ALL
  USING (EXISTS (SELECT 1 FROM incident i WHERE i.id = investigation.incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incident i WHERE i.id = investigation.incident_id));

--> statement-breakpoint

CREATE POLICY investigation_cause_visibility ON investigation_cause
  AS RESTRICTIVE
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM investigation v WHERE v.id = investigation_cause.investigation_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM investigation v WHERE v.id = investigation_cause.investigation_id));

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA
-- MIGRACIÓN, Y ESA AUSENCIA ES EL REQUISITO.
--
-- La tentación acá es corregir: un supervisor que se equivocó de clasificación, una
-- narrativa con un error de tipeo. Ninguna de las dos es un UPDATE. §4 ya tiene la
-- respuesta y se llama `RegistroSuplementario` —entrada adicional con `supersedes_id`,
-- autor y motivo, con el original visible y marcado como superado—, y no existe
-- todavía. Hasta que exista, corregir es reportar de nuevo.
GRANT SELECT, INSERT ON
  incident,
  incident_event,
  incident_witness,
  investigation,
  investigation_cause
  TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. La bandeja gana un tipo de notificación.
--
-- §3 R4: "El sistema muestra los relojes regulatorios que aplican y notifica al
-- coordinador de HS." Misma cuenta que 0011 pagó por sus tres tipos: la lista está
-- cerrada desde 0008 y ampliarla exige pasar por una migración a propósito.
--
-- El payload lleva el id, la clasificación y los dos instantes — NUNCA el nombre ni el
-- número de empleado del sujeto (design D11). `notification` no tiene la política de §8:
-- la lee su destinatario y punto.
ALTER TABLE notification
  DROP CONSTRAINT notification_kind_check;

--> statement-breakpoint

ALTER TABLE notification
  ADD CONSTRAINT notification_kind_check CHECK (kind IN (
    'inspection_period_opened',
    'corrective_action_assigned',
    'corrective_action_overdue_supervisor',
    'corrective_action_overdue_management',
    'incident_reported'));
