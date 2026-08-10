-- Requisitos §4 (Hallazgo), §3 R2 y §7 etapa 4 — EL HALLAZGO Y SU CLASIFICACIÓN.
--
-- 0009 dejó el envío congelado y sus respuestas escritas, y dejó una línea de
-- comentario donde iba lo que falta: derivar el hallazgo de la respuesta negativa. Esta
-- migración crea dónde vive eso. Es el paso que le faltaba a la costura crítica 1 de
-- ADR-008 —`insertar Respuestas → derivar Hallazgos → escribir eventos`— y lo que le da
-- a la etapa 5 de dónde colgar una acción correctiva.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   Un hallazgo nace de una inspección O a mano, nunca a medias   CHECK de origen (§1)
--   `item_key` es la del ítem publicado que se contestó           FK compuesta (§1)
--   El hallazgo es del mismo sitio que su inspección              FK compuesta (§1)
--   La ubicación es del sitio del hallazgo                        FK compuesta (§1)
--   La descripción dice algo                                      CHECK de largo (§1)
--   Un hallazgo sin foto no llega a existir                       trigger diferido (§4)
--   El nivel de riesgo lo calcula el motor                        columna generada (§5)
--   Una sola clasificación inicial por hallazgo                   único parcial (§5)
--   La historia de clasificación no se bifurca                    único de supersedes (§5)
--   Reclasificar exige motivo; clasificar por primera vez no      CHECK de motivo (§5)
--   Cada hallazgo y cada clasificación dejan su eslabón           triggers (§6)
--   Nadie modifica ni borra nada de esto                          hs_make_immutable (§7, §8)
--   Nadie ve los hallazgos de la otra planta                      hs_apply_site_isolation (§7)
--
-- La columna de la derecha es lo que hace que la propiedad se cumpla. El servicio
-- comprueba algunas de las mismas cosas para devolverle al dispositivo un código que su
-- outbox sepa clasificar; si el servicio se equivoca, el motor rechaza igual.
--
-- ESTA MIGRACIÓN NO ALTERA NINGUNA TABLA EXISTENTE. Ni un `ALTER`, ni una columna
-- nueva, ni una restricción agregada: los tres destinos de FK compuesta que hacen falta
-- —`location_site_id_uq` (0004), `inspection_id_site_uq` (0009) y
-- `template_version_item_id_key_uq` (0009)— ya existen. Es la primera migración de
-- tablas nuevas que no necesita tocar nada de lo anterior, y conviene que quede escrito.
--
-- LAS TRES TABLAS SON ÍNTEGRAMENTE INMUTABLES, como las de 0009 y por el mismo motivo.
-- Reclasificar un hallazgo NO es corregir una fila: es insertar otra que supera a la
-- vigente. El historial de qué se dijo que valía este riesgo, y por qué cambió, es
-- exactamente el dato que después hace falta.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que las anteriores:
--   HS002  invariante de identidad violada (reusado de 0003, 0005 y 0009)
--   HS003  hallazgo sin foto al momento del commit (nuevo, §4)

-- ---------------------------------------------------------------------------
-- 1. `finding` — el hallazgo.
--
-- Dos orígenes en una sola tabla, y no dos tablas. Un hallazgo derivado y uno manual
-- tienen el mismo dueño, la misma ubicación, la misma foto obligatoria, la misma
-- clasificación y la misma acción correctiva colgando: separarlos duplicaría todo eso
-- para distinguir tres columnas. Lo que los distingue vive en el CHECK de más abajo.
--
-- LA IDENTIDAD DUAL DE §4, otra vez, y esta es la fila donde de verdad importa:
--   template_version_item_id  la pregunta exacta que se hizo — fidelidad legal
--   item_key                  el concepto estable — la clave de la recurrencia (etapa 7)
--
-- Un hallazgo manual tiene las dos en NULL y por lo tanto queda fuera de la detección
-- de recurrencia. Es la consecuencia que §4 y el riesgo F ya aceptaron por escrito: el
-- casi-accidente que un supervisor presencia entra por acá y no cuenta para la serie.
CREATE TABLE finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- Redundante con la nulabilidad de las tres columnas de abajo, y se paga a
  -- propósito: el listado y la recurrencia filtran por origen sin razonar sobre tres
  -- nulos. El CHECK de coherencia impide que esta columna mienta.
  origin text NOT NULL CHECK (origin IN ('inspection', 'manual')),

  inspection_id uuid REFERENCES inspection (id),
  template_version_item_id uuid REFERENCES template_version_item (id),
  item_key text REFERENCES template_item (item_key),

  -- La lista cerrada de la pregunta 1 de §6. NOT NULL en los dos orígenes: "en algún
  -- lugar de 48 acres" no sirve para arreglar nada ni para agrupar nada.
  location_id uuid NOT NULL REFERENCES location (id),

  description text NOT NULL,

  -- Quién lo vio: el inspector que firmó el envío, o quien lo cargó a mano.
  reported_by uuid NOT NULL REFERENCES app_user (id),

  -- Riesgo C de §5, igual que en `inspection`: `occurred_at` es el reloj del
  -- dispositivo —el `signed_at` del envío para un hallazgo derivado— y `recorded_at`
  -- el del servidor, que es el único que ordena.
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  -- EXACTAMENTE UN ORIGEN. Las tres columnas de la identidad dual están las tres o no
  -- está ninguna, y `origin` dice cuál de las dos cosas es.
  --
  -- Es la misma forma que §4 fija para el parentesco de la acción correctiva —dos FK
  -- nulables y un CHECK que exige una y solo una—, así que la etapa 5 se encuentra un
  -- patrón ya visto y no uno inventado ahí.
  -- `finding_origin_check` ya está tomado: Postgres auto-nombra así el CHECK inline de
  -- la columna `origin`. Este es el otro, el de coherencia entre las cuatro columnas.
  CONSTRAINT finding_origin_identity_check CHECK (
    (origin = 'inspection') = (inspection_id IS NOT NULL)
    AND (inspection_id IS NULL) = (item_key IS NULL)
    AND (inspection_id IS NULL) = (template_version_item_id IS NULL)
  ),

  -- Una descripción de dos caracteres no describe nada. El mínimo es el mismo que el
  -- de `findingDetailsSchema` en `@hs/contracts`: el contrato lo rechaza antes para
  -- devolver un error legible, esto lo rechaza igual por cualquier otro camino.
  CONSTRAINT finding_description_check CHECK (char_length(description) >= 10),

  -- El hallazgo es del mismo sitio que su inspección. Sin esto, la política RLS de una
  -- tabla y la de la otra dirían cosas distintas sobre el mismo registro.
  FOREIGN KEY (inspection_id, site_id)
    REFERENCES inspection (id, site_id),

  -- La que defiende la identidad dual: el `item_key` de esta fila es el del ítem
  -- publicado que referencia, o no hay fila. Mismo mecanismo que en `inspection_answer`.
  FOREIGN KEY (template_version_item_id, item_key)
    REFERENCES template_version_item (id, item_key),

  -- La ubicación es del sitio del hallazgo. Que esté activa o no NO se comprueba acá:
  -- el dispositivo lleva el catálogo de cuando se preparó la inspección, y rechazar un
  -- envío porque el coordinador desactivó una ubicación mientras el inspector caminaba
  -- convertiría una edición administrativa en una inspección perdida. El servicio sí lo
  -- exige en el camino manual, que es online y contra una lista fresca.
  FOREIGN KEY (site_id, location_id)
    REFERENCES location (site_id, id)
);

--> statement-breakpoint

-- El destino de las FK compuestas de `finding_photo` y `finding_risk_assessment`: ni
-- una foto ni una clasificación pueden pertenecer a un sitio distinto del de su
-- hallazgo. Mismo truco que `inspection_id_site_uq` en 0009 §3.
ALTER TABLE finding
  ADD CONSTRAINT finding_id_site_uq UNIQUE (id, site_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Los índices.

-- EL ÍNDICE DE LA RECURRENCIA (etapa 7), y el que de verdad importa: "la misma guarda
-- falta cuatro meses seguidos" es un GROUP BY de esta tabla por `item_key` dentro de
-- una planta. Parcial sobre los derivados: un hallazgo manual no tiene `item_key` y no
-- entra en ninguna serie, así que tampoco tiene por qué ocupar el índice.
--
-- El límite conocido del riesgo A queda en pie: esta clave da "la misma pregunta", no
-- "la misma pregunta en el mismo lugar". Por eso el índice lleva también `location_id`:
-- la consulta que agrupe por concepto Y ubicación sale del mismo índice, y cuál de las
-- dos se usa es una decisión de la etapa 7 y no de esta migración.
CREATE INDEX finding_recurrence_idx
  ON finding (site_id, item_key, location_id)
  WHERE item_key IS NOT NULL;

--> statement-breakpoint

-- Los hallazgos de una inspección: la lectura que sigue a un envío aceptado.
CREATE INDEX finding_inspection_idx ON finding (inspection_id);

--> statement-breakpoint

-- El listado por planta, en orden de servidor.
CREATE INDEX finding_site_recorded_idx ON finding (site_id, recorded_at);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `finding_photo` — la foto obligatoria de R2.
--
-- Una fila por object key, y no un `text[]` en `finding`. El arreglo sería más simple y
-- se descarta igual: una foto es algo que la política RLS filtra, que la cadena de
-- auditoría puede nombrar, y que mañana puede llevar un orden o un pie. Sobre todo,
-- `finding` es inmutable: con un arreglo, agregar la foto que el inspector sacó dos
-- minutos después exigiría reescribir la fila, que es imposible. Con filas, es una fila
-- nueva. (Ese endpoint no existe en este change; la puerta queda abierta y sin costo.)
--
-- ADR-001: object keys, nunca bytes. Las fotos se suben con presigned URLs antes del
-- envío y esto las referencia.
CREATE TABLE finding_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  finding_id uuid NOT NULL REFERENCES finding (id),

  -- Denormalizado por el mismo motivo que en `inspection_answer`: la política RLS
  -- necesita el sitio EN LA FILA. La FK compuesta impide que diga otra cosa.
  site_id uuid NOT NULL REFERENCES site (id),

  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 512),

  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (finding_id, site_id)
    REFERENCES finding (id, site_id)
);

--> statement-breakpoint

-- La misma foto no se cuenta dos veces en el mismo hallazgo.
CREATE UNIQUE INDEX finding_photo_key_uq ON finding_photo (finding_id, object_key);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. "AL MENOS UNA FOTO", como restricción diferida.
--
-- Un CHECK no puede contar filas de otra tabla, y un trigger BEFORE INSERT sobre
-- `finding` correría antes de que las fotos existan: el orden natural es insertar el
-- hallazgo y después sus fotos, porque las fotos necesitan su `finding_id`.
--
-- Una CONSTRAINT TRIGGER diferida verifica AL COMMIT, que es el único momento en que la
-- pregunta tiene sentido. Permite el orden natural y sigue haciendo imposible commitear
-- un hallazgo sin foto por cualquier camino — endpoint, seed o INSERT a mano.
CREATE OR REPLACE FUNCTION hs_finding_photo_required()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finding_photo p WHERE p.finding_id = NEW.id) THEN
    RAISE EXCEPTION
      'finding % has no photo', NEW.id
      USING ERRCODE = 'HS003',
            HINT = 'A finding carries a description, a location and at least one photo.';
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER finding_photo_required
  AFTER INSERT ON finding
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_finding_photo_required();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. La clasificación de riesgo.
--
-- LA MATRIZ, como función IMMUTABLE, para poder alimentar una columna generada.
--
-- Que el nivel sea una columna generada y no un valor que el caller manda es la
-- decisión: no hay camino —endpoint, seed, INSERT a mano— por el que alguien pueda
-- escribir "bajo" sobre un `likely × catastrophic`. El caller aporta los dos ejes; el
-- nivel es una consecuencia.
--
-- La misma matriz está escrita en `apps/api/src/findings/risk.ts`, porque la UI y la
-- respuesta del endpoint la necesitan sin ida y vuelta a la base. SQL no puede importar
-- TypeScript: la duplicación es deliberada y un test de integración compara las 25
-- celdas de las dos. Mismo precedente que el CHECK de `response_type` en 0007.
--
-- Los cortes: producto de índices 1..5, `<=4` bajo, `5..9` medio, `10..14` alto, `>=15`
-- crítico. Las cuatro listas son las mismas de `@hs/contracts`, y el mismo test las
-- compara.
CREATE OR REPLACE FUNCTION hs_risk_level(p_probability text, p_severity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p IS NULL OR s IS NULL THEN NULL
    WHEN p * s <= 4 THEN 'low'
    WHEN p * s <= 9 THEN 'medium'
    WHEN p * s <= 14 THEN 'high'
    ELSE 'critical'
  END
  FROM (
    SELECT
      array_position(
        ARRAY['rare', 'unlikely', 'possible', 'likely', 'almost_certain'], p_probability) AS p,
      array_position(
        ARRAY['negligible', 'minor', 'moderate', 'major', 'catastrophic'], p_severity) AS s
  ) AS axes;
$fn$;

--> statement-breakpoint

-- LA CLASIFICACIÓN ES UNA LISTA ENLAZADA APPEND-ONLY, no una tabla con `is_current`.
--
-- Un booleano de vigencia exigiría un UPDATE sobre una tabla inmutable, que es
-- imposible por definición. Un `ORDER BY assessed_at DESC LIMIT 1` empata si dos filas
-- caen en el mismo microsegundo y no impide que la historia se bifurque. `supersedes_id`
-- con un único hace las dos cosas sin lock y sin ventana.
--
-- La vigente es la fila que nadie supera:
--   WHERE NOT EXISTS (SELECT 1 FROM finding_risk_assessment s WHERE s.supersedes_id = a.id)
--
-- Un hallazgo sin ninguna fila acá está SIN CLASIFICAR. No hay columna de estado ni fila
-- sembrada al derivar: es una ausencia, igual que el estado de la acción correctiva se
-- deriva de sus eventos y no de un campo.
CREATE TABLE finding_risk_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  finding_id uuid NOT NULL REFERENCES finding (id),

  -- Denormalizado, misma razón que las otras dos: la política RLS lo necesita en la fila.
  site_id uuid NOT NULL REFERENCES site (id),

  -- Las mismas listas cerradas que `PROBABILITIES` y `SEVERITIES` en `@hs/contracts`, y
  -- las mismas que la matriz de arriba indexa. Un test compara las tres copias.
  probability text NOT NULL CHECK (
    probability IN ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  severity text NOT NULL CHECK (
    severity IN ('negligible', 'minor', 'moderate', 'major', 'catastrophic')),

  -- CALCULADA. No está en ningún request y no hay GRANT que permita escribirla.
  risk_level text NOT NULL GENERATED ALWAYS AS (hs_risk_level(probability, severity)) STORED,

  -- La jerarquía de controles de R2: dónde está parada la solución propuesta. El
  -- sistema la registra y NO la juzga — que la respuesta a un riesgo crítico haya sido
  -- un par de guantes es exactamente el dato que después hace falta poder ver.
  control_level text NOT NULL CHECK (
    control_level IN ('elimination', 'substitution', 'engineering', 'administrative', 'ppe')),

  -- La fila que esta supera. NULL en la primera clasificación de un hallazgo.
  --
  -- El UNIQUE es lo que impide que la historia se bifurque: dos reclasificaciones
  -- concurrentes de la misma vigente terminan con una que comete y otra que viola el
  -- único. Sin lock, sin ventana, sin secuencia que mantener.
  supersedes_id uuid UNIQUE REFERENCES finding_risk_assessment (id),

  reason text,

  assessed_by uuid NOT NULL REFERENCES app_user (id),
  assessed_at timestamptz NOT NULL DEFAULT now(),

  -- RECLASIFICAR EXIGE MOTIVO Y CLASIFICAR POR PRIMERA VEZ NO LO ADMITE.
  --
  -- "Por qué cambió" es el dato que hace auditable un cambio de riesgo; "por qué es
  -- así" la primera vez sería un campo obligatorio que nadie sabe llenar, y se llenaría
  -- con ruido. La igualdad afirma las dos mitades de una sola vez.
  CONSTRAINT finding_risk_assessment_reason_check CHECK (
    (supersedes_id IS NULL) = (reason IS NULL)
  ),

  CONSTRAINT finding_risk_assessment_reason_length_check CHECK (
    reason IS NULL OR char_length(reason) >= 10
  ),

  FOREIGN KEY (finding_id, site_id)
    REFERENCES finding (id, site_id)
);

--> statement-breakpoint

-- UNA SOLA CLASIFICACIÓN INICIAL POR HALLAZGO.
--
-- Sin esto, dos primeras clasificaciones del mismo hallazgo dejarían dos vigentes —
-- ninguna supera a la otra— y "la clasificación actual" dejaría de ser una pregunta con
-- respuesta.
--
-- Sirve además como índice del `LEFT JOIN LATERAL` del listado, que busca exactamente
-- estas filas.
CREATE UNIQUE INDEX finding_risk_assessment_initial_uq
  ON finding_risk_assessment (finding_id)
  WHERE supersedes_id IS NULL;

--> statement-breakpoint

-- El historial completo de un hallazgo, en orden.
CREATE INDEX finding_risk_assessment_finding_idx
  ON finding_risk_assessment (finding_id, assessed_at);

--> statement-breakpoint

-- La clasificación que supera a otra tiene que ser del MISMO hallazgo.
--
-- El único de `supersedes_id` impide la bifurcación, pero no sabe que las dos filas
-- hablan del mismo hallazgo: sin este trigger, una reclasificación podría encadenarse a
-- la clasificación de otro hallazgo y el historial de los dos quedaría mezclado.
CREATE OR REPLACE FUNCTION hs_finding_assessment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  superseded_finding uuid;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.finding_id INTO superseded_finding
    FROM finding_risk_assessment a WHERE a.id = NEW.supersedes_id;

  IF superseded_finding IS DISTINCT FROM NEW.finding_id THEN
    RAISE EXCEPTION
      'assessment supersedes one of finding % but belongs to %',
      superseded_finding, NEW.finding_id
      USING ERRCODE = 'HS002',
            HINT = 'A reclassification supersedes the current assessment of its own finding.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER finding_assessment_guard
  BEFORE INSERT ON finding_risk_assessment
  FOR EACH ROW EXECUTE FUNCTION hs_finding_assessment_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. La auditoría.
--
-- UN ESLABÓN POR HALLAZGO Y UNO POR CLASIFICACIÓN. Ninguno por foto: cuatro fotos de un
-- mismo hallazgo no son cuatro eventos, y la cadena serializa por sitio (0002).
--
-- El tipo de evento sale de `origin`, no de dos triggers: es el mismo hecho —apareció un
-- hallazgo— con dos procedencias, y quien lea la cadena necesita distinguirlas.
CREATE OR REPLACE FUNCTION hs_finding_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  photo_count integer;
BEGIN
  -- Al momento del AFTER INSERT las fotos pueden no estar todavía —la restricción de
  -- §4 es diferida justamente por eso—, así que este número es "cuántas había cuando
  -- nació" y no reemplaza a la restricción. Se registra igual: es lo que una
  -- verificación posterior compara contra la tabla.
  SELECT count(*) INTO photo_count FROM finding_photo p WHERE p.finding_id = NEW.id;

  PERFORM hs_audit_entry_at(
    NEW.site_id,
    CASE WHEN NEW.origin = 'inspection' THEN 'finding.derived' ELSE 'finding.reported' END,
    jsonb_build_object(
      'finding_id', NEW.id,
      'site_id', NEW.site_id,
      'origin', NEW.origin,
      'inspection_id', NEW.inspection_id,
      'template_version_item_id', NEW.template_version_item_id,
      'item_key', NEW.item_key,
      'location_id', NEW.location_id,
      'reported_by', NEW.reported_by,
      'photo_count', photo_count),
    -- El reloj del dispositivo: el hallazgo ocurrió cuando el inspector lo vio, aunque
    -- haya llegado seis días después (riesgo C).
    NEW.occurred_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER finding_audit
  AFTER INSERT ON finding
  FOR EACH ROW EXECUTE FUNCTION hs_finding_audit();

--> statement-breakpoint

-- La clasificación deja en la cadena qué se dijo que valía este riesgo, quién lo dijo y
-- —si cambió— por qué. `risk_level` viaja calculado: la cadena registra el nivel que el
-- motor asignó, no el que alguien haya afirmado.
CREATE OR REPLACE FUNCTION hs_finding_assessment_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'finding.classified',
    jsonb_build_object(
      'finding_id', NEW.finding_id,
      'assessment_id', NEW.id,
      'site_id', NEW.site_id,
      'probability', NEW.probability,
      'severity', NEW.severity,
      'risk_level', NEW.risk_level,
      'control_level', NEW.control_level,
      'supersedes_id', NEW.supersedes_id,
      'reason', NEW.reason,
      'assessed_by', NEW.assessed_by),
    -- Clasificar ocurre mientras el servidor mira: el reloj del dispositivo no aporta
    -- nada acá y `assessed_at` ya es el del servidor.
    NEW.assessed_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER finding_assessment_audit
  AFTER INSERT ON finding_risk_assessment
  FOR EACH ROW EXECUTE FUNCTION hs_finding_assessment_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Inmutabilidad y aislamiento.
SELECT hs_make_immutable('finding');

--> statement-breakpoint

SELECT hs_make_immutable('finding_photo');

--> statement-breakpoint

SELECT hs_make_immutable('finding_risk_assessment');

--> statement-breakpoint

SELECT hs_apply_site_isolation('finding');

--> statement-breakpoint

SELECT hs_apply_site_isolation('finding_photo');

--> statement-breakpoint

SELECT hs_apply_site_isolation('finding_risk_assessment');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA
-- MIGRACIÓN, Y ESA AUSENCIA ES EL REQUISITO — igual que en 0009.
--
-- La tentación acá es más fuerte que allá: reclasificar *parece* un UPDATE de dos
-- columnas. No lo es. Un riesgo que se reevalúa es un hecho nuevo sobre el mismo
-- hallazgo, y el que se dijo antes no deja de haberse dicho.
GRANT SELECT, INSERT ON finding, finding_photo, finding_risk_assessment TO hs_app;
