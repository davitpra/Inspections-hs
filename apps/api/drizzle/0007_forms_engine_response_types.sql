-- ---------------------------------------------------------------------------
-- 0007 — El modelo publicado aprende los nueve tipos de respuesta.
--
-- `packages/forms` pasa a describir nueve `response_type` y a admitir lógica
-- condicional en el documento. `template_version_item` tiene que poder recibir
-- lo que ese documento publica; si no, un documento válido para el motor sería
-- imposible de publicar y la proyección fallaría recién en el primer seed nuevo.
--
-- Corre con `hs_migrator`, como todas. Es **solo DDL**: no hay un UPDATE ni un
-- DELETE de fila en todo el archivo. `template_version` y `template_version_item`
-- son inmutables (ADR-002) y siguen siéndolo — se cambia la restricción y la
-- función del trigger, nunca un dato ya publicado.
--
-- SQLSTATE que usa: 'HS003' (el documento no se puede proyectar a filas), el
-- mismo de 0003. No agrega códigos nuevos.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. El enum de `response_type`.
--
-- La lista está duplicada respecto de `RESPONSE_TYPES` en `packages/forms`: SQL
-- no puede importar TypeScript. La duplicación es deliberada y está bajo prueba
-- — `test/forms-engine.int-spec.ts` lee esta restricción de `pg_constraint` y la
-- compara contra la lista del paquete, así que no puede divergir en silencio.
-- Es el mismo criterio que ya sigue el patrón de `item_key` en 0003.
ALTER TABLE template_version_item
  DROP CONSTRAINT IF EXISTS template_version_item_response_type_check;

--> statement-breakpoint

ALTER TABLE template_version_item
  ADD CONSTRAINT template_version_item_response_type_check
  CHECK (response_type IN (
    'yes_no', 'yes_no_na', 'scale', 'text', 'number',
    'single_choice', 'multi_choice', 'photo', 'signature'
  ));

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Configuración y visibilidad del ítem, proyectadas.
--
-- Nulables a propósito. Las filas ya publicadas describen ítems de los cuatro
-- tipos originales, que no llevan configuración: la ausencia es correcta y no
-- una deuda. Re-proyectarlas exigiría escribir sobre una tabla inmutable, que es
-- justo lo que ADR-002 impide.
--
-- La fuente de verdad para validar un envío sigue siendo
-- `template_version.document`. Estas columnas existen para consultar y para la
-- serie de recurrencia, no para validar.
ALTER TABLE template_version_item ADD COLUMN config jsonb;

--> statement-breakpoint

ALTER TABLE template_version_item ADD COLUMN visible_when jsonb;

--> statement-breakpoint

-- No hace falta re-aplicar `hs_make_immutable()`: tanto el `REVOKE UPDATE,
-- DELETE` a `hs_app` como el trigger `BEFORE UPDATE OR DELETE` que 0003 le puso
-- a esta tabla son a nivel tabla, no a nivel columna. Las columnas nuevas nacen
-- cubiertas.

-- ---------------------------------------------------------------------------
-- 3. La proyección copia lo nuevo.
--
-- Reemplaza la función de 0003. El cuerpo es el mismo salvo el INSERT final: la
-- validación de sección vacía, de `item_key` desactivada y el SQLSTATE no
-- cambian.
--
-- `config` es "el ítem menos los campos comunes": así un tipo de respuesta nuevo
-- proyecta su configuración sin tocar esta función. Un ítem sin configuración
-- propia (yes_no, yes_no_na, signature) deja `config` en NULL en vez de en un
-- objeto vacío — "no tiene configuración" y "tiene una configuración vacía" no
-- son lo mismo para quien después lea la fila.
CREATE OR REPLACE FUNCTION hs_template_project_items()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  section jsonb;
  item jsonb;
  item_config jsonb;
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

      item_config := item
        - 'item_key' - 'prompt' - 'position' - 'required'
        - 'response_type' - 'visible_when';

      INSERT INTO template_version_item (
        template_version_id, item_key, section_key, section_title,
        "position", prompt, response_type, required, config, visible_when
      )
      VALUES (
        NEW.id,
        item ->> 'item_key',
        section ->> 'section_key',
        section ->> 'section_title',
        (item ->> 'position')::integer,
        item ->> 'prompt',
        item ->> 'response_type',
        (item ->> 'required')::boolean,
        CASE WHEN item_config = '{}'::jsonb THEN NULL ELSE item_config END,
        item -> 'visible_when'
      );
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$fn$;
