-- Requisitos §4 y §5 riesgo A — El modelo de plantillas y la identidad dual del ítem.
--
-- Es la primera tabla de dominio del proyecto. Todo lo que sigue —inspecciones,
-- respuestas, hallazgos— apunta a un `template_version_id`, así que la identidad
-- del ítem se decide acá o no se decide.
--
-- El riesgo A no produce ningún error: si el hallazgo apunta solo a la fila de la
-- versión, cada edición de plantilla parte la serie histórica, la consulta sigue
-- devolviendo filas y el dashboard muestra "no hay hallazgos recurrentes". Por eso
-- todo lo que se pueda mover al motor está en esta migración y no en el servicio
-- de publicación: una regla que el builder de la etapa 8 "debe respetar" es una
-- regla que el builder va a poder violar sin error.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs propios de esta migración, en el mismo espacio 'HS' que 0001:
--   HS001  append-only (reusado de 0001)
--   HS002  la versión publicada no es la siguiente de esa plantilla
--   HS003  el documento no se puede proyectar a filas

-- ---------------------------------------------------------------------------
-- 1. `template` — la cabecera.
--
-- Es la única tabla del change que admite UPDATE, y solo sobre `name` y
-- `deactivated_at`. No es inmutable: corregir el nombre de una plantilla no
-- reescribe ningún registro regulatorio.
--
-- Sin `site_id` y por lo tanto sin política RLS, a propósito: una plantilla es
-- contenido de referencia de la organización, no un dato de sitio. Si llevara
-- `site_id`, la misma inspección mensual existiría dos veces con dos juegos de
-- `item_key` y "la misma guarda falta en los dos sitios" dejaría de ser
-- consultable. El aislamiento por sitio vive donde están los datos de sitio:
-- `inspection` y `finding`, de las etapas 3 y 4.
CREATE TABLE template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clave natural y estable. Es lo que usa el seed para ser idempotente.
  key text NOT NULL UNIQUE,

  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nunca DELETE: una plantilla retirada sigue siendo la referencia de las
  -- inspecciones que se hicieron con ella.
  deactivated_at timestamptz
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `template_item` — el CONCEPTO, no su proyección en una versión.
--
-- Existe separada por una razón concreta: §4 exige que un ítem se **desactive**
-- en lugar de borrarse, y `deactivated_at` es un UPDATE. Pero §4 exige también
-- que una versión publicada sea inalterable. Las dos cosas no pueden vivir en la
-- misma fila. Con el concepto aparte, desactivar toca esta tabla y no toca
-- ninguna versión ya publicada — que es exactamente la semántica del requisito:
-- desaparece de las versiones nuevas, sigue resolviendo desde los hallazgos
-- históricos, y la serie de recurrencia termina en lugar de romperse.
CREATE TABLE template_item (
  -- `item_key` puede ser legible en los seeds históricos y opaca en las plantillas
  -- creadas desde el editor. Es PK **global**, no única por plantilla: §4 dice que
  -- no se reutiliza ni se recicla, y "no se recicla" solo tiene sentido si el espacio
  -- de nombres es uno solo.
  --
  -- El patrón está duplicado en `packages/contracts/src/template-document.ts`.
  -- Si uno cambia, el otro también.
  item_key text PRIMARY KEY CHECK (item_key ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),

  template_id uuid NOT NULL REFERENCES template (id),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- La quinta garantía de §4: los ítems se desactivan, nunca se borran.
  deactivated_at timestamptz,

  -- Linaje (§4). Si un ítem se divide en dos o dos se fusionan en uno, ninguno de
  -- los resultantes hereda limpiamente la key original. Esto deja el rastro.
  --
  -- Es rastro, NO regla de agrupación: la consulta de recurrencia no une la serie
  -- del reemplazante con la del reemplazado. Si la etapa 7 quiere unirlas, es una
  -- decisión explícita de esa etapa, con su propio test.
  replaces_item_key text REFERENCES template_item (item_key),

  CONSTRAINT template_item_replaces_not_self CHECK (replaces_item_key IS DISTINCT FROM item_key)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `template_version` — el documento publicado, congelado.
--
-- Una versión publicada nunca se edita: se publica otra. `hs_make_immutable` al
-- final de la migración.
CREATE TABLE template_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES template (id),

  version integer NOT NULL CHECK (version >= 1),

  -- El documento JSONB. Su forma la valida `templateDocumentSchema` de
  -- `@hs/contracts`; sus referencias las validan las FKs y el trigger de
  -- proyección de más abajo. Zod valida la forma; el motor valida las referencias.
  document jsonb NOT NULL,

  published_at timestamptz NOT NULL DEFAULT now(),

  -- Sin FK a propósito: la tabla `user` es de la etapa 2, que agrega la
  -- referencia. Mismo criterio que `audit_log.site_id` en 0002.
  published_by uuid,

  -- Una versión repetida haría ambiguo a qué documento apunta una inspección.
  CONSTRAINT template_version_template_version_uq UNIQUE (template_id, version)
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `template_version_item` — la proyección en filas, y la identidad dual.
--
-- Los dos identificadores resuelven dos problemas distintos y no se pueden
-- conflar:
--
--   id        la fila concreta dentro de esta versión publicada. Es a lo que
--             apunta un hallazgo para la fidelidad legal: qué pregunta se hizo,
--             con esa redacción exacta, en esa sección, con ese tipo de
--             respuesta, el día que se contestó. Cambia en cada versión.
--
--   item_key  el concepto. Es la clave de agrupación de la detección de
--             hallazgos recurrentes. NO cambia: reescribir el ítem, moverlo de
--             sección, reordenarlo o cambiarle el tipo de respuesta conserva la
--             key. Solo un ítem conceptualmente nuevo recibe key nueva.
CREATE TABLE template_version_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL REFERENCES template_version (id),

  -- La FK es la que garantiza que toda fila de ítem resuelve a un concepto
  -- registrado. Sin ella, un documento podría inventar una key en el momento de
  -- publicar y partir la serie sin que nada fallara.
  item_key text NOT NULL REFERENCES template_item (item_key),

  section_key text NOT NULL,
  section_title text NOT NULL,

  -- `position` es col_name_keyword en Postgres: va entrecomillado en todas las
  -- sentencias de esta migración para que nunca dependa del contexto.
  "position" integer NOT NULL CHECK ("position" >= 1),

  prompt text NOT NULL,

  -- El mismo enum que `responseTypeSchema` en `@hs/contracts`. El scoring
  -- ponderado salió de v1 (§5 riesgo E), así que un ítem no lleva peso.
  response_type text NOT NULL
    CHECK (response_type IN ('yes_no', 'scale', 'text', 'number')),

  required boolean NOT NULL,

  -- Un concepto no puede aparecer dos veces en la misma versión: se contestaría
  -- dos veces y la recurrencia contaría doble.
  CONSTRAINT template_version_item_key_uq UNIQUE (template_version_id, item_key),

  -- Dos ítems en la misma posición dentro de una sección hacen que el orden del
  -- formulario dependa de cómo lo devuelva el motor.
  CONSTRAINT template_version_item_position_uq
    UNIQUE (template_version_id, section_key, "position")
);

--> statement-breakpoint

-- El índice que va a necesitar el GROUP BY de recurrencia de la etapa 7. Se crea
-- acá porque es la lectura para la que existe la columna, no una optimización.
CREATE INDEX template_version_item_key_idx ON template_version_item (item_key);

--> statement-breakpoint

-- "Cuál es la versión vigente de esta plantilla" es la lectura más frecuente.
CREATE INDEX template_version_current_idx ON template_version (template_id, version DESC);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Numeración de versiones.
--
-- Una versión salteada rompería la lectura "qué preguntaba la plantilla en tal
-- fecha". El lock advisory por plantilla es el mismo recurso que usa la cadena de
-- `audit_log` en 0002: sin él, dos publicaciones concurrentes leen el mismo
-- max(version) y una de las dos se pierde contra el único.
CREATE OR REPLACE FUNCTION hs_template_version_next()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('template_version:' || NEW.template_id::text));

  SELECT coalesce(max(version), 0) + 1
    INTO expected
    FROM template_version
   WHERE template_id = NEW.template_id;

  IF NEW.version <> expected THEN
    RAISE EXCEPTION
      'template version % is not the next version of template % (expected %)',
      NEW.version, NEW.template_id, expected
      USING ERRCODE = 'HS002',
            HINT = 'Template versions are consecutive and start at 1; publish the next one.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER template_version_next
  BEFORE INSERT ON template_version
  FOR EACH ROW EXECUTE FUNCTION hs_template_version_next();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Proyección del documento a filas.
--
-- Lo hace el motor y no el servicio de publicación porque en v1 las plantillas se
-- cargan como seeds SQL: un seed insertaría el documento y no las filas, la
-- inspección se renderizaría igual desde el JSONB, y la consulta de recurrencia
-- devolvería vacío sin un solo error. Es la forma de fallar del riesgo A, otra vez.
--
-- Que el documento exista y las filas no es, con este trigger, un estado
-- imposible.
CREATE OR REPLACE FUNCTION hs_template_project_items()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  section jsonb;
  item jsonb;
  item_deactivated_at timestamptz;
  item_exists boolean;
BEGIN
  IF jsonb_typeof(NEW.document -> 'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.document -> 'sections') = 0 THEN
    RAISE EXCEPTION
      'template version %.% has no sections to project', NEW.template_id, NEW.version
      USING ERRCODE = 'HS003',
            HINT = 'The document must carry a non-empty "sections" array.';
  END IF;

  FOR section IN SELECT * FROM jsonb_array_elements(NEW.document -> 'sections')
  LOOP
    IF jsonb_typeof(section -> 'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(section -> 'items') = 0 THEN
      RAISE EXCEPTION
        'section "%" of template version %.% has no items',
        section ->> 'section_key', NEW.template_id, NEW.version
        USING ERRCODE = 'HS003';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(section -> 'items')
    LOOP
      -- Una `item_key` no registrada la rechaza la FK del INSERT de más abajo.
      -- Una desactivada no: la FK resuelve igual. Es el hueco que §5 cerró con
      -- la regla de desactivar en lugar de borrar, y hay que cerrarlo acá.
      SELECT true, ti.deactivated_at
        INTO item_exists, item_deactivated_at
        FROM template_item ti
       WHERE ti.item_key = item ->> 'item_key';

      IF item_exists AND item_deactivated_at IS NOT NULL THEN
        RAISE EXCEPTION
          'item_key "%" is deactivated and cannot appear in a new template version',
          item ->> 'item_key'
          USING ERRCODE = 'HS003',
                HINT = 'Register a new item_key; a deactivated concept ends its series.';
      END IF;

      INSERT INTO template_version_item (
        template_version_id, item_key, section_key, section_title,
        "position", prompt, response_type, required
      )
      VALUES (
        NEW.id,
        item ->> 'item_key',
        section ->> 'section_key',
        section ->> 'section_title',
        (item ->> 'position')::integer,
        item ->> 'prompt',
        item ->> 'response_type',
        (item ->> 'required')::boolean
      );
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER template_version_project_items
  AFTER INSERT ON template_version
  FOR EACH ROW EXECUTE FUNCTION hs_template_project_items();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. `item_key` inmutable, `deactivated_at` mutable.
--
-- `template_item` necesita UPDATE para `deactivated_at`, así que no se le puede
-- aplicar `hs_make_immutable`. En su lugar lleva su propio BEFORE UPDATE que
-- rechaza todo lo demás — con el mismo SQLSTATE 'HS001'. Es la única forma de
-- tener una tabla parcialmente mutable sin que "parcialmente" quiera decir "en la
-- práctica, entera".
CREATE OR REPLACE FUNCTION hs_template_item_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.item_key IS DISTINCT FROM OLD.item_key
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.replaces_item_key IS DISTINCT FROM OLD.replaces_item_key THEN
    RAISE EXCEPTION
      'template_item is append-only except for deactivated_at: updating item_key "%" is not allowed',
      OLD.item_key
      USING ERRCODE = 'HS001',
            HINT = 'item_key is assigned once and never reused; deactivate instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER template_item_guard
  BEFORE UPDATE ON template_item
  FOR EACH ROW EXECUTE FUNCTION hs_template_item_guard();

--> statement-breakpoint

-- Ni la plantilla ni el concepto se borran nunca: se desactivan. Se reusa el
-- `hs_forbid_mutation()` de 0001 en lugar de escribir otro — es el mismo hecho.
CREATE TRIGGER template_item_forbid_deletion
  BEFORE DELETE ON template_item
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER template_item_forbid_truncate
  BEFORE TRUNCATE ON template_item
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER template_forbid_deletion
  BEFORE DELETE ON template
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER template_forbid_truncate
  BEFORE TRUNCATE ON template
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Inmutabilidad de la versión publicada.
--
-- `hs_make_immutable` instala el trigger BEFORE UPDATE OR DELETE y revoca
-- UPDATE, DELETE y TRUNCATE a hs_app. No toca INSERT: por eso el trigger de
-- proyección de la sección 6 sigue pudiendo escribir en `template_version_item`.
SELECT hs_make_immutable('template_version');

--> statement-breakpoint

SELECT hs_make_immutable('template_version_item');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` conceden SELECT e INSERT sobre
-- toda tabla nueva. Acá se retira el INSERT: en v1 las plantillas las publica el
-- seed bajo hs_migrator, y la API solo lee.
--
-- La etapa 8 (builder visual) concederá INSERT sobre estas tablas. Nunca UPDATE:
-- publicar es insertar una versión nueva.
REVOKE INSERT ON template, template_item, template_version, template_version_item FROM hs_app;

--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON template, template_item FROM hs_app;

--> statement-breakpoint

GRANT SELECT ON template, template_item, template_version, template_version_item TO hs_app;
