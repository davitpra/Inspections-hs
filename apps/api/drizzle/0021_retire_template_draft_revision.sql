-- Requisitos §7 etapa 8 — Retirar el lock optimista del borrador.
--
-- ESTA MIGRACIÓN NO TOCA NINGUNA TABLA INMUTABLE. Solo modifica `template_draft`,
-- que sigue siendo la excepción mutable declarada en 0016 §4. Los triggers
-- `template_draft_forbid_deletion` y `template_draft_forbid_truncate` de 0016 §3
-- no cambian: descartar sigue siendo UPDATE y borrar sigue prohibido.
--
-- Dos ventanas del mismo autor ya no tienen una garantía de concurrencia propia.
-- ADR-001 establece un dueño, un dispositivo y un firmante, y acepta perder
-- borradores. Con el lock retirado, el último guardado de un borrador vivo gana;
-- la segunda ventana puede pisar silenciosamente a la primera. Ese costo es
-- deliberado: este borrador no debe ofrecer una garantía que el resto del
-- producto no ofrece.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. El contador no es parte del documento ni de la historia del borrador.
--
-- `template_draft_revision_check` cae con la columna; no necesita una sentencia
-- propia. La fila siempre ha conservado solo el documento actual, no versiones
-- históricas, así que no se pierde información al retirar el contador.
ALTER TABLE template_draft
  DROP COLUMN revision;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. La lista completa de columnas que hs_app puede actualizar.
--
-- Se reescribe entera, no con un REVOKE suelto: una sola sentencia debe bastar
-- para auditar qué es mutable. `key` y `created_by` siguen fuera por las razones
-- de 0016 §4; `site_ids` sigue siendo contenido de uso, no aislamiento por sitio.
GRANT UPDATE (name, document, updated_at, discarded_at, site_ids)
  ON template_draft TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. El alcance por sitio no es RLS.
--
-- 0016 §5 y 0020 §5 siguen vigentes: `template_draft` no tiene `site_id`,
-- `site_ids` describe dónde se piensa usar la plantilla y la autorización sigue
-- siendo por rol. Los triggers de borrado y truncate tampoco cambian.
SELECT 1;
