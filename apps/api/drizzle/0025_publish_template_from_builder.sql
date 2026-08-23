-- Requisitos §7 etapa 8 (segunda mitad) — Publicar un borrador como versión 1.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. El builder puede insertar el modelo publicado, pero nunca modificarlo.
--
-- La sección 9 de `0003_template_model.sql` dejó anunciado este GRANT para la
-- publicación de la etapa 8. También se concede sobre `template_version_item`
-- porque el trigger de proyección de `0003` no es SECURITY DEFINER: corre como
-- `hs_app` y necesita insertar las filas que deriva del documento. No se concede
-- UPDATE ni DELETE sobre ninguna de estas tablas.
GRANT INSERT ON template, template_item, template_version, template_version_item TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Un borrador publicado conserva el rastro de la versión que produjo.
ALTER TABLE template_draft
  ADD COLUMN published_at timestamptz,
  ADD COLUMN template_version_id uuid REFERENCES template_version (id),
  ADD CONSTRAINT template_draft_publication_pair_check
    CHECK ((published_at IS NULL) = (template_version_id IS NULL)),
  ADD CONSTRAINT template_draft_discarded_published_check
    CHECK (discarded_at IS NULL OR published_at IS NULL);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Lista completa de columnas que `hs_app` puede actualizar.
--
-- `key`, `created_by`, `id` y `created_at` siguen siendo write-once. La lista
-- completa se reescribe para que una sola sentencia siga describiendo toda la
-- mutabilidad, como en 0016 §4, 0020 §4 y 0021 §2.
GRANT UPDATE (name, document, updated_at, discarded_at, site_ids, published_at, template_version_id)
  ON template_draft TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Publicar consume la reserva de nombre y clave del borrador.
DROP INDEX template_draft_key_live_idx;

--> statement-breakpoint

CREATE UNIQUE INDEX template_draft_key_live_idx
  ON template_draft (key)
  WHERE discarded_at IS NULL AND published_at IS NULL;

--> statement-breakpoint

DROP INDEX template_draft_name_live_idx;

--> statement-breakpoint

CREATE UNIQUE INDEX template_draft_name_live_idx
  ON template_draft (lower(btrim(name)))
  WHERE discarded_at IS NULL AND published_at IS NULL;
