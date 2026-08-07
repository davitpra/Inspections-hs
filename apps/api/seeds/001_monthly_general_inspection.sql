-- Plantilla de inspección general mensual — la primera plantilla real del sistema.
--
-- Requisitos §7: "las primeras plantillas se cargan como seeds en SQL". El builder
-- visual es la etapa 8; hasta entonces esta es la única vía de carga, y es a
-- propósito: el sistema tiene que ser utilizable sin el builder.
--
-- IDEMPOTENTE. `pnpm db:seed` se corre las veces que haga falta.
--
-- Sobre cómo se logra la idempotencia de `template_version`: NO se usa
-- `ON CONFLICT DO NOTHING`. El trigger `template_version_next` es BEFORE INSERT y
-- corre antes de que el índice único llegue a resolver el conflicto, así que en la
-- segunda corrida rechazaría la versión 1 —ya existe, la siguiente es la 2— antes
-- de que `ON CONFLICT` pudiera tragarse nada. Con `WHERE NOT EXISTS` no se intenta
-- la fila y el trigger nunca se dispara.

INSERT INTO template (key, name)
VALUES ('monthly-general-inspection', 'Monthly general workplace inspection')
ON CONFLICT (key) DO NOTHING;

-- Los conceptos. Se registran una sola vez y sobreviven a toda edición de la
-- plantilla: reescribir el texto, mover el ítem de sección, reordenarlo o
-- cambiarle el tipo de respuesta NO genera una key nueva.
INSERT INTO template_item (item_key, template_id)
SELECT registered_key, t.id
  FROM template t,
       unnest(ARRAY[
         'guards.packaging-lines',
         'guards.emergency-stops',
         'housekeeping.aisles-clear',
         'housekeeping.spills-addressed',
         'housekeeping.waste-removed',
         'electrical.panels-accessible',
         'electrical.cords-undamaged',
         'emergency.exits-unobstructed',
         'emergency.extinguishers-charged',
         'emergency.first-aid-stocked'
       ]) AS registered_key
 WHERE t.key = 'monthly-general-inspection'
ON CONFLICT (item_key) DO NOTHING;

-- La versión 1. El documento es la fuente de la que el trigger
-- `template_version_project_items` deriva las filas de `template_version_item`:
-- no hace falta —ni se puede— escribirlas acá.
INSERT INTO template_version (template_id, version, document)
SELECT t.id, 1, $document$
{
  "sections": [
    {
      "section_key": "machine-safety",
      "section_title": "Machine safety",
      "position": 1,
      "items": [
        {
          "item_key": "guards.packaging-lines",
          "prompt": "Are machine guards in place and secured on all packaging lines?",
          "position": 1,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "guards.emergency-stops",
          "prompt": "Are emergency stops reachable and functional at every station?",
          "position": 2,
          "response_type": "yes_no",
          "required": true
        }
      ]
    },
    {
      "section_key": "housekeeping",
      "section_title": "Housekeeping",
      "position": 2,
      "items": [
        {
          "item_key": "housekeeping.aisles-clear",
          "prompt": "Are aisles and walkways clear of obstructions?",
          "position": 1,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "housekeeping.spills-addressed",
          "prompt": "Have spills been cleaned up or contained?",
          "position": 2,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "housekeeping.waste-removed",
          "prompt": "Is waste and debris removed from work areas?",
          "position": 3,
          "response_type": "yes_no",
          "required": true
        }
      ]
    },
    {
      "section_key": "electrical",
      "section_title": "Electrical",
      "position": 3,
      "items": [
        {
          "item_key": "electrical.panels-accessible",
          "prompt": "Are electrical panels unobstructed and closed?",
          "position": 1,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "electrical.cords-undamaged",
          "prompt": "Are extension cords and cables free of visible damage?",
          "position": 2,
          "response_type": "yes_no",
          "required": true
        }
      ]
    },
    {
      "section_key": "emergency-preparedness",
      "section_title": "Emergency preparedness",
      "position": 4,
      "items": [
        {
          "item_key": "emergency.exits-unobstructed",
          "prompt": "Are emergency exits unobstructed and clearly marked?",
          "position": 1,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "emergency.extinguishers-charged",
          "prompt": "Are fire extinguishers charged and inspected within the last month?",
          "position": 2,
          "response_type": "yes_no",
          "required": true
        },
        {
          "item_key": "emergency.first-aid-stocked",
          "prompt": "Are first aid stations stocked and sealed?",
          "position": 3,
          "response_type": "yes_no",
          "required": true
        }
      ]
    }
  ]
}
$document$::jsonb
  FROM template t
 WHERE t.key = 'monthly-general-inspection'
   AND NOT EXISTS (
     SELECT 1 FROM template_version v
      WHERE v.template_id = t.id AND v.version = 1
   );
