-- Catálogo global de ubicaciones conceptuales y mapeo por planta.
--
-- `organization_location` es contenido de referencia de la organización, como `template`:
-- no lleva `site_id` ni RLS. Cada planta mapea su catálogo físico por separado.
-- Esta migración no modifica ninguna tabla inmutable.

CREATE TABLE organization_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

--> statement-breakpoint

CREATE TRIGGER organization_location_guard
  BEFORE UPDATE ON organization_location
  FOR EACH ROW EXECUTE FUNCTION hs_catalog_guard();

--> statement-breakpoint

CREATE TRIGGER organization_location_forbid_deletion
  BEFORE DELETE ON organization_location
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER organization_location_forbid_truncate
  BEFORE TRUNCATE ON organization_location
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- No `hs_make_immutable`: names and deactivation are the two allowed updates.
GRANT SELECT, INSERT ON organization_location TO hs_app;
GRANT UPDATE (name, deactivated_at) ON organization_location TO hs_app;

--> statement-breakpoint

ALTER TABLE location
  ADD COLUMN organization_location_id uuid
    REFERENCES organization_location (id);

--> statement-breakpoint

ALTER TABLE location
  ADD CONSTRAINT location_site_organization_location_uq
  UNIQUE (site_id, organization_location_id);

--> statement-breakpoint

GRANT UPDATE (organization_location_id) ON location TO hs_app;
