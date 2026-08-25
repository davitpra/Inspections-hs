-- Requisitos §7 — Archivar plantillas publicadas retiradas desde la consola.
--
-- Archivar cambia la presencia de la cabecera en la tabla de administración, no el
-- documento publicado ni las inspecciones que lo referencian. La marca solo puede
-- aparecer sobre una plantilla retirada; la invariante vive en el motor y no en el
-- servicio.

ALTER TABLE template
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT template_archive_check
    CHECK (archived_at IS NULL OR deactivated_at IS NOT NULL);

--> statement-breakpoint

-- Reafirmar la lista completa evita heredar por accidente un UPDATE amplio.
REVOKE UPDATE ON template FROM hs_app;
GRANT UPDATE (deactivated_at, archived_at) ON template TO hs_app;
