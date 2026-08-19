-- Catálogo conceptual inicial. Los códigos que coinciden entre plantas representan
-- la misma ubicación organizacional y cada planta queda mapeada a su propia fila física.
-- IDEMPOTENTE: nunca pisa nombres ni mapeos que el coordinador haya corregido.

SELECT set_config(
  'app.site_ids',
  '5717e900-0000-4000-8000-000000000001,5717e900-0000-4000-8000-000000000002',
  true);

INSERT INTO organization_location (code, name)
SELECT code, min(name)
  FROM location
 GROUP BY code
ON CONFLICT (code) DO NOTHING;

UPDATE location l
   SET organization_location_id = ol.id
  FROM organization_location ol
 WHERE l.organization_location_id IS NULL
   AND l.code = ol.code;
