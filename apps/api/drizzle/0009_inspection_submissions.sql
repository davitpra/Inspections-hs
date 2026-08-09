-- Requisitos §4 (Inspección, Respuesta) y ADR-008 — LA COSTURA CRÍTICA 1.
--
-- Hasta acá el sistema sabe qué preguntar (0003, 0007), quién puede preguntarlo
-- (0005, 0006) y que hay que preguntarlo (0008). Esta migración crea lo que queda
-- cuando el inspector terminó de recorrer: el registro congelado del envío y sus
-- respuestas. Es el punto de no retorno de R1 y el único lugar donde el sistema
-- puede corromper un registro legal.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   Un `client_submission_id`, un registro         único (§3)
--   Una inspección programada, un envío            único (§3)
--   La versión enviada es la congelada             guarda hs_inspection_freeze_guard (§5)
--   La respuesta pertenece a la versión enviada    guarda hs_inspection_answer_guard (§5)
--   `item_key` es la del ítem referenciado         FK compuesta (§1, §4)
--   La respuesta es del mismo sitio que su envío   FK compuesta (§3, §4)
--   Un ítem no se contesta dos veces               único (§4)
--   Nadie modifica ni borra un envío               hs_make_immutable + GRANT (§7, §8)
--   Nadie ve el envío de otra planta               hs_apply_site_isolation (§7)
--   Cada envío deja su eslabón en la cadena        trigger de auditoría (§6)
--
-- La columna de la derecha es lo que hace que la propiedad se cumpla. El servicio de
-- `apps/api/src/inspections/submissions.service.ts` comprueba casi lo mismo, pero eso
-- es para devolver un error legible al dispositivo: si el servicio se equivoca, el
-- motor rechaza igual.
--
-- LAS DOS TABLAS SON ÍNTEGRAMENTE INMUTABLES, y por eso llevan `hs_make_immutable` y
-- ningún `GRANT UPDATE`. Es lo contrario de 0008 —donde reasignar y cancelar exigían
-- una lista corta de columnas mutables—: un envío firmado no tiene ninguna columna
-- que alguien pueda corregir. Corregir una inspección enviada es un
-- `RegistroSuplementario` que la supera, y llega en su propio change.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que las anteriores:
--   HS002  invariante de identidad violada (reusado de 0003 y 0005)

-- ---------------------------------------------------------------------------
-- 1. El destino de la FK compuesta hacia `template_version_item`.
--
-- `inspection_answer` guarda `item_key` además de `template_version_item_id`, y esa
-- denormalización ES el requisito, no una comodidad: `item_key` es la clave de
-- agrupación de la recurrencia (§4, identidad dual) y tiene que estar en la fila que
-- se agrupa, no a un join de distancia. Pero una denormalización que el motor no
-- defiende es una mentira esperando su turno: sin esto, una respuesta podría afirmar
-- que contesta el ítem `dock.guards` mientras referencia la fila publicada de
-- `exits.blocked`, y la serie histórica de los dos conceptos quedaría mezclada.
--
-- Redundante como restricción —`id` ya es PK— y necesaria igual: Postgres exige un
-- único sobre las columnas exactas para poder ser destino de una FK compuesta. Mismo
-- truco que `template_version_id_template_uq` en 0008 §1 y `location_site_id_uq` en
-- 0004.
--
-- ADD CONSTRAINT sobre una tabla inmutable es legal: `hs_make_immutable` bloquea DML
-- (UPDATE, DELETE, TRUNCATE), no DDL. Ninguna fila se toca. Precedentes en 0005 y 0008.
ALTER TABLE template_version_item
  ADD CONSTRAINT template_version_item_id_key_uq UNIQUE (id, item_key);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `hs_audit_entry_at` — el append al log con el reloj del dispositivo.
--
-- `hs_identity_audit_entry(site, kind, body)` de 0005 fija `occurred_at := now()`, y
-- eso alcanzó para todo lo escrito hasta hoy porque todo ocurría mientras el servidor
-- miraba. Un envío no: se firma el 3 en un rincón sin señal y llega el 9. Registrarlo
-- como ocurrido el 9 es exactamente lo que el riesgo C de §5 prohíbe, y lo que el
-- doble timestamp de `audit_log` existe para evitar.
--
-- Se agrega la variante de cuatro argumentos y la de tres pasa a delegar en ella con
-- `now()`. Ningún trigger existente cambia de comportamiento — hay un test que lo
-- afirma, no una promesa en este comentario.
CREATE OR REPLACE FUNCTION hs_audit_entry_at(
  target_site uuid, kind text, body jsonb, occurred timestamptz)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
  VALUES (
    target_site,
    nullif(current_setting('app.user_id', true), '')::uuid,
    kind,
    body,
    occurred,
    -- `recorded_at` y `hash` los sobrescribe el trigger de la cadena de 0002. Se
    -- mandan porque son NOT NULL, y lo que se manda es irrelevante por definición.
    now(), ''::bytea);
END;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_identity_audit_entry(
  target_site uuid, kind text, body jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(target_site, kind, body, now());
END;
$fn$;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `inspection` — el envío congelado.
--
-- Una fila por inspección enviada. No hay estado: `borrador` vive en el IndexedDB del
-- dispositivo y no llega nunca acá (ADR-001), y `superada`/`anulada` son la existencia
-- de otra fila que la supere, en un change posterior. Una fila de esta tabla significa
-- una sola cosa, y significa siempre lo mismo: esto se inspeccionó, esto se contestó,
-- esta persona lo firmó.
--
-- COPIA `site_id` y `template_version_id` en vez de leerlos por join a
-- `scheduled_inspection`. No es cache: `site_id` es lo que la política RLS necesita en
-- la fila, y `template_version_id` es lo que hace que la respuesta pueda tener una FK
-- compuesta contra su versión. Que la copia sea fiel lo defiende la guarda del §5.
CREATE TABLE inspection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),
  scheduled_inspection_id uuid NOT NULL REFERENCES scheduled_inspection (id),
  template_version_id uuid NOT NULL REFERENCES template_version (id),

  -- LA CLAVE DE IDEMPOTENCIA DEL SISTEMA ENTERO (ADR-001). La genera el dispositivo
  -- junto con el borrador —no al enviar— y no cambia nunca. El único de abajo es lo
  -- que hace que reintentar sobre la red de una planta sea seguro.
  client_submission_id uuid NOT NULL,

  -- NOT NULL, a diferencia de `scheduled_by` en 0008: un envío siempre tiene un
  -- firmante. Un dueño, un dispositivo, un firmante (§4). Nada automático firma.
  submitted_by uuid NOT NULL REFERENCES app_user (id),

  -- Riesgo C de §5, otra vez y por el mismo motivo que en `audit_log`: `signed_at` es
  -- el reloj del dispositivo, que puede ser de días atrás y puede estar mal puesto;
  -- `received_at` es el del servidor y es el único que ordena.
  signed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),

  -- Cuántas respuestas se escribieron con este envío. Es lo que una verificación de
  -- integridad compara contra `inspection_answer` sin tener que confiar en que nadie
  -- borró filas — que no puede, pero el punto de una verificación es no asumirlo.
  answer_count integer NOT NULL CHECK (answer_count >= 0)
);

--> statement-breakpoint

-- LA IDEMPOTENCIA, y es un único y no una comprobación previa del servicio.
--
-- El servicio inserta con `ON CONFLICT (client_submission_id) DO NOTHING` y, si no
-- vuelve ninguna fila, lee la existente y responde `created: false`. Un `SELECT`
-- previo tendría una ventana entre la lectura y la escritura, y el outbox del
-- dispositivo puede robar su propio lock y mandar el mismo id dos veces a la vez: la
-- mitad que corre en el dispositivo delega en el motor precisamente esta corrección.
CREATE UNIQUE INDEX inspection_client_submission_uq
  ON inspection (client_submission_id);

--> statement-breakpoint

-- UN ENVÍO POR INSPECCIÓN PROGRAMADA. Un segundo envío con otro
-- `client_submission_id` para el mismo período no es un reenvío: es otro dispositivo,
-- u otro borrador, y ninguno de los dos existe en este sistema (§4, ADR-001).
--
-- Total y no parcial, a diferencia de `scheduled_inspection_open_period_uq`: hoy no
-- hay ningún estado que excluya una fila —no existe `superseded_at`— y un parcial
-- sobre una condición que siempre es verdadera es un único disfrazado. El change de
-- `RegistroSuplementario` decide si pasa a parcial, con la semántica de superación en
-- la mano.
CREATE UNIQUE INDEX inspection_scheduled_uq
  ON inspection (scheduled_inspection_id);

--> statement-breakpoint

-- El destino de la FK compuesta de `inspection_answer`: una respuesta no puede
-- pertenecer a un sitio distinto del de su inspección. Mismo truco que el §1.
ALTER TABLE inspection
  ADD CONSTRAINT inspection_id_site_uq UNIQUE (id, site_id);

--> statement-breakpoint

-- El listado por planta en orden de servidor: "qué se envió acá, y cuándo".
CREATE INDEX inspection_site_received_idx ON inspection (site_id, received_at);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `inspection_answer` — las respuestas, COMO FILAS.
--
-- LA DECISIÓN CENTRAL DE ESTA MIGRACIÓN: una fila por respuesta, no un documento
-- JSONB con el conjunto entero. El `value` de UNA respuesta sí es jsonb, porque una
-- respuesta puede ser un booleano, un número, una cadena o una lista de object keys
-- según el `response_type` del ítem, y esa variedad es del dominio.
--
-- Por qué no un solo JSONB con todo el conjunto: la consulta de recurrencia de la
-- etapa 7 —"cuántas veces salió mal este concepto en esta planta en estos períodos"—
-- agrupa por `item_key`. Con las respuestas adentro de un documento, esa consulta
-- tiene que expandir el documento de cada inspección para poder agrupar, y ningún
-- índice la ayuda. Con filas, es un GROUP BY sobre una columna indexada. La diferencia
-- no se nota con 24 inspecciones al año; se nota el día que haya que escribirla, y
-- para entonces la tabla es inmutable y tiene registros regulatorios adentro.
--
-- LA IDENTIDAD DUAL DE §4 VIVE EN ESTAS DOS COLUMNAS:
--   template_version_item_id  la fila publicada que se contestó — fidelidad legal
--   item_key                  el concepto estable — clave de agrupación
CREATE TABLE inspection_answer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  inspection_id uuid NOT NULL REFERENCES inspection (id),

  -- Denormalizado desde `inspection` y no leído por join, porque la política RLS de
  -- esta tabla necesita el sitio EN LA FILA. La FK compuesta de abajo es lo que
  -- impide que diga otra cosa que la verdad.
  site_id uuid NOT NULL REFERENCES site (id),

  template_version_item_id uuid NOT NULL REFERENCES template_version_item (id),
  item_key text NOT NULL REFERENCES template_item (item_key),

  -- La respuesta en la forma que `@hs/forms` define por `response_type`. Un ítem de
  -- foto guarda el array de object keys; NUNCA bytes (ADR-001).
  value jsonb NOT NULL,

  FOREIGN KEY (inspection_id, site_id)
    REFERENCES inspection (id, site_id),

  -- La que defiende la identidad dual: el `item_key` de esta fila es el del ítem
  -- publicado que referencia, o no hay fila.
  FOREIGN KEY (template_version_item_id, item_key)
    REFERENCES template_version_item (id, item_key)
);

--> statement-breakpoint

-- Un ítem se contesta una vez por inspección. Dos filas para el mismo concepto en el
-- mismo envío harían que la recurrencia cuente dos veces un solo incumplimiento.
CREATE UNIQUE INDEX inspection_answer_item_uq
  ON inspection_answer (inspection_id, item_key);

--> statement-breakpoint

-- EL ÍNDICE DE LA RECURRENCIA (etapa 7). El filtro es por planta y el agrupamiento por
-- concepto, así que van en ese orden; el rango de períodos vive en
-- `scheduled_inspection.period_start` y se resuelve por el join, que sale por PK.
--
-- Con 24 inspecciones al año por planta ningún índice hace falta por volumen. Se
-- escribe igual porque el único momento honesto para declarar cuál es la clave de
-- agrupación es cuando se diseña la tabla, y porque agregarlo después es un
-- CREATE INDEX en producción sobre registros regulatorios que no se pueden reconstruir.
CREATE INDEX inspection_answer_recurrence_idx
  ON inspection_answer (site_id, item_key);

--> statement-breakpoint

-- La lectura de una inspección completa: todas sus respuestas.
CREATE INDEX inspection_answer_inspection_idx
  ON inspection_answer (inspection_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Las guardas. La barrera que alcanza también a hs_migrator.
--
-- Estas dos NO protegen columnas de un UPDATE —el §7 ya prohíbe todo UPDATE— sino la
-- COHERENCIA DE UN INSERT. Es una diferencia real con la guarda de 0008: acá lo que
-- puede llegar mal no es una corrección indebida, es una fila que nace mintiendo.
--
-- Lo que una FK no sabe expresar: "y además la versión es la que esta inspección
-- programada tiene congelada". Eso es una consulta a una tercera tabla, y por eso es
-- un trigger.

-- La versión enviada tiene que ser la congelada al programar, y la inspección
-- programada no puede estar cancelada.
--
-- Sin esto, el dispositivo podría declarar que interpretó el formulario con la v3
-- recién publicada mientras el inspector recorrió con la v2 que se le entregó, y el
-- registro legal diría que se preguntó algo que nadie preguntó.
CREATE OR REPLACE FUNCTION hs_inspection_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  frozen_version uuid;
  frozen_site uuid;
  cancelled timestamptz;
BEGIN
  SELECT s.template_version_id, s.site_id, s.cancelled_at
    INTO frozen_version, frozen_site, cancelled
    FROM scheduled_inspection s
   WHERE s.id = NEW.scheduled_inspection_id;

  IF NEW.template_version_id IS DISTINCT FROM frozen_version THEN
    RAISE EXCEPTION
      'submission names template version % but the inspection is frozen against %',
      NEW.template_version_id, frozen_version
      USING ERRCODE = 'HS002',
            HINT = 'A submission is recorded against the version the inspector was given.';
  END IF;

  -- El sitio de la inspección enviada es el de la programada. Si difirieran, la
  -- política RLS de una tabla y la de la otra dirían cosas distintas sobre la misma
  -- inspección.
  IF NEW.site_id IS DISTINCT FROM frozen_site THEN
    RAISE EXCEPTION
      'submission claims site % but the inspection belongs to %', NEW.site_id, frozen_site
      USING ERRCODE = 'HS002';
  END IF;

  IF cancelled IS NOT NULL THEN
    RAISE EXCEPTION
      'the scheduled inspection was cancelled on %', cancelled
      USING ERRCODE = 'HS002',
            HINT = 'A cancelled period does not accept a submission.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER inspection_freeze_guard
  BEFORE INSERT ON inspection
  FOR EACH ROW EXECUTE FUNCTION hs_inspection_freeze_guard();

--> statement-breakpoint

-- La respuesta contesta un ítem DE LA VERSIÓN QUE SE ENVIÓ.
--
-- La FK compuesta del §4 garantiza que el `item_key` sea el del ítem referenciado, y
-- la FK simple que el ítem exista. Ninguna de las dos sabe que el ítem tiene que
-- pertenecer a la versión de ESTA inspección: sin este trigger, un envío contra la v2
-- podría guardar la respuesta de un ítem que solo existe en la v3.
CREATE OR REPLACE FUNCTION hs_inspection_answer_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  answered_version uuid;
  item_version uuid;
BEGIN
  SELECT i.template_version_id INTO answered_version
    FROM inspection i WHERE i.id = NEW.inspection_id;

  SELECT v.template_version_id INTO item_version
    FROM template_version_item v WHERE v.id = NEW.template_version_item_id;

  IF item_version IS DISTINCT FROM answered_version THEN
    RAISE EXCEPTION
      'answer names an item of template version % but the inspection was submitted against %',
      item_version, answered_version
      USING ERRCODE = 'HS002',
            HINT = 'Every answer belongs to the version the inspection was frozen against.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER inspection_answer_guard
  BEFORE INSERT ON inspection_answer
  FOR EACH ROW EXECUTE FUNCTION hs_inspection_answer_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. La auditoría del envío.
--
-- UNA ENTRADA POR ENVÍO Y NINGUNA POR RESPUESTA, y es deliberado. Doscientos ítems no
-- pueden ser doscientos eslabones: la cadena serializa por sitio con un lock de
-- advisory (0002) y la verificación ante el MLITSD la recorre entera. Las respuestas
-- no necesitan su propia entrada porque ya están en una tabla que ningún rol puede
-- modificar — que es una garantía más fuerte que un eslabón, no más débil.
--
-- `answer_count` viaja en el payload: es lo que una verificación compara contra la
-- tabla sin tener que confiar en el conteo del momento.
--
-- Un reenvío idempotente no escribe nada acá y no hay ninguna condición que lo
-- decida: el `ON CONFLICT DO NOTHING` del servicio no inserta, y este trigger es
-- AFTER INSERT.
CREATE OR REPLACE FUNCTION hs_inspection_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_audit_entry_at(
    NEW.site_id,
    'inspection.submitted',
    jsonb_build_object(
      'inspection_id', NEW.id,
      'scheduled_inspection_id', NEW.scheduled_inspection_id,
      'site_id', NEW.site_id,
      'template_version_id', NEW.template_version_id,
      'client_submission_id', NEW.client_submission_id,
      'submitted_by', NEW.submitted_by,
      'answer_count', NEW.answer_count),
    -- El reloj del dispositivo, no el de la transacción: la inspección ocurrió
    -- cuando se firmó, aunque haya llegado seis días después.
    NEW.signed_at);

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER inspection_audit
  AFTER INSERT ON inspection
  FOR EACH ROW EXECUTE FUNCTION hs_inspection_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Inmutabilidad y aislamiento.
--
-- `hs_make_immutable` pone el trigger de UPDATE/DELETE para CUALQUIER rol —hs_migrator
-- incluido, que por dueño siempre podría— y revoca lo que haya de hs_app.
-- `hs_apply_site_isolation` pone la política: sin alcance declarado, ninguna de las
-- dos devuelve una sola fila, y ese es el default correcto.
SELECT hs_make_immutable('inspection');

--> statement-breakpoint

SELECT hs_make_immutable('inspection_answer');

--> statement-breakpoint

SELECT hs_apply_site_isolation('inspection');

--> statement-breakpoint

SELECT hs_apply_site_isolation('inspection_answer');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA
-- MIGRACIÓN, Y ESA AUSENCIA ES EL REQUISITO: 0008 tenía que enumerar lo mutable
-- porque reasignar y cancelar existen; acá no hay nada que corregir. Un envío firmado
-- se supera con otra fila o no se toca.
--
-- Si un change futuro necesita cambiar algo de una inspección enviada, la respuesta
-- correcta no es agregar un GRANT acá: es `RegistroSuplementario`.
GRANT SELECT, INSERT ON inspection, inspection_answer TO hs_app;
