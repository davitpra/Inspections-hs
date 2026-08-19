-- Un hallazgo derivado puede quedar sin ubicación cuando la sección no se puede
-- resolver contra el catálogo de la planta. La recurrencia conserva la serie de
-- la pregunta, pero no inventa una ubicación.

ALTER TABLE finding
  ALTER COLUMN location_id DROP NOT NULL;

--> statement-breakpoint

ALTER TABLE finding_recurrence
  ALTER COLUMN location_id DROP NOT NULL;
