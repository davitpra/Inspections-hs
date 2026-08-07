-- El catálogo inicial de ubicaciones de cada planta.
--
-- Requisitos §6 pregunta cerrada 1: la ubicación del hallazgo se elige de esta
-- lista. El coordinador la administra desde la aplicación; lo que hay acá es el
-- punto de partida para que el sistema sea usable desde el primer día, igual que
-- las plantillas del seed 001.
--
-- IDEMPOTENTE. `ON CONFLICT (site_id, code) DO NOTHING`, nunca `DO UPDATE`:
-- pisaría un `name` que el coordinador ya corrigió.

-- ---------------------------------------------------------------------------
-- El alcance de sitio, ANTES de cualquier INSERT.
--
-- `location` lleva `hs_apply_site_isolation`, que hace FORCE ROW LEVEL SECURITY.
-- Eso alcanza también a hs_migrator —dueño de la tabla— que es el rol con el que
-- corren los seeds: sin esta línea, el `WITH CHECK` de la política rechaza cada
-- INSERT con un error que no menciona RLS por ningún lado.
--
-- Es la primera demostración escrita de que el aislamiento no tiene puerta
-- trasera para el rol de migración. La alternativa era darle BYPASSRLS a
-- hs_migrator, y esa puerta quedaría abierta siempre, no solo durante el seed.
--
-- `true` es SET LOCAL: el alcance muere con la transacción, y `scripts/seed.mjs`
-- abre una por archivo. Con `false` quedaría pegado a la conexión física después
-- del COMMIT, y la suite de integración —que aplica estos mismos seeds sobre un
-- pool que después reusa— vería filas en transacciones que no declararon nada. Es
-- el mismo bug de pooling contra el que advierte `src/db/site-scope.ts`.
SELECT set_config(
  'app.site_ids',
  '5717e900-0000-4000-8000-000000000001,5717e900-0000-4000-8000-000000000002',
  true);

-- ---------------------------------------------------------------------------
-- St. Thomas.
INSERT INTO location (site_id, code, name)
SELECT s.id, entry.code, entry.name
  FROM site s,
       (VALUES
         ('receiving-dock', 'Receiving dock'),
         ('shipping-dock', 'Shipping dock'),
         ('packaging-line-1', 'Packaging line 1'),
         ('packaging-line-2', 'Packaging line 2'),
         ('packaging-line-3', 'Packaging line 3'),
         ('cold-storage', 'Cold storage'),
         ('maintenance-shop', 'Maintenance shop'),
         ('boiler-room', 'Boiler room'),
         ('warehouse', 'Warehouse'),
         ('yard', 'Yard'),
         ('offices', 'Offices'),
         ('lunchroom', 'Lunchroom')
       ) AS entry (code, name)
 WHERE s.code = 'st-thomas'
ON CONFLICT (site_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Glencoe. Los dos sitios son espacios de nombres independientes: `shipping-dock`
-- existe en los dos y son dos filas distintas, con dos ids distintos.
INSERT INTO location (site_id, code, name)
SELECT s.id, entry.code, entry.name
  FROM site s,
       (VALUES
         ('receiving-dock', 'Receiving dock'),
         ('shipping-dock', 'Shipping dock'),
         ('processing-line-1', 'Processing line 1'),
         ('processing-line-2', 'Processing line 2'),
         ('cold-storage', 'Cold storage'),
         ('maintenance-shop', 'Maintenance shop'),
         ('warehouse', 'Warehouse'),
         ('yard', 'Yard'),
         ('offices', 'Offices'),
         ('lunchroom', 'Lunchroom')
       ) AS entry (code, name)
 WHERE s.code = 'glencoe'
ON CONFLICT (site_id, code) DO NOTHING;
