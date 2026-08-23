-- Requisitos §7 etapa 8 — Retirar el nivel de control de la prescripción de una pregunta.
--
-- ESTA MIGRACIÓN NO CREA TABLAS NI COLUMNAS, NO CONCEDE NI REVOCA PERMISOS Y NO
-- TOCA NINGUNA POLÍTICA RLS. Solo reescribe el contenido de `template_draft.document`,
-- una columna ya mutable cuyo UPDATE fue concedido en 0021. `template_version.document`
-- es inmutable por ADR-002 y nunca se reescribe acá.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el comentario
-- de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. Una versión publicada con este campo requiere una decisión, no una limpieza muda.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM template_version
     WHERE jsonb_path_exists(
       document,
       '$.sections[*].items[*].finding.control_level'
     )
  ) THEN
    RAISE EXCEPTION
      'A published template_version carries finding.control_level. Its document is immutable under ADR-002; stop the migration and decide how to resolve that published record.';
  END IF;
END
$$;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Los borradores sí son la excepción mutable. Se reconstruyen ambos arreglos
--    con ordinality porque su orden ES la position que se derivará al publicar.
--    No se toca updated_at: una reparación de esquema no es una edición del autor.
UPDATE template_draft
   SET document = jsonb_set(
     document,
     '{sections}',
     COALESCE(
       (
         SELECT jsonb_agg(
           jsonb_set(
             section_json,
             '{items}',
             COALESCE(
               (
                 SELECT jsonb_agg(
                   item_json #- '{finding,control_level}'
                   ORDER BY item_ord
                 )
                   FROM jsonb_array_elements(section_json->'items')
                     WITH ORDINALITY AS item(item_json, item_ord)
               ),
               '[]'::jsonb
             )
           )
           ORDER BY section_ord
         )
           FROM jsonb_array_elements(document->'sections')
             WITH ORDINALITY AS section(section_json, section_ord)
       ),
       '[]'::jsonb
     )
   )
 WHERE jsonb_path_exists(
   document,
   '$.sections[*].items[*].finding.control_level'
 );

--> statement-breakpoint

SELECT 1;
