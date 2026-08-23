-- Las dos plantas. Requisitos §1: St. Thomas y Glencoe.
--
-- IDEMPOTENTE. `pnpm db:seed` se corre las veces que haga falta.
--
-- LOS IDs SON LITERALES FIJOS, NO `gen_random_uuid()`. No es cosmético:
--
--   1. `003_locations.sql` tiene que declarar `app.site_ids` ANTES de insertar la
--      primera ubicación, porque `location` lleva política RLS con FORCE. Con ids
--      generados no habría qué declarar hasta después del INSERT que la política
--      justamente rechaza.
--   2. Los fixtures y los tests de integración nombran un sitio sin una
--      subconsulta, y sin depender del orden en que se sembró.
--
-- Son UUID v4 bien formados —nibble de versión `4`, nibble de variante `8`— y no
-- `1111...` a secas: `z.uuid()` de `@hs/contracts` valida la variante, así que un
-- id con forma inválida rompería el contrato del cliente sin romper la base.
--
-- `site` no lleva política RLS (ver el comentario de la migración 0004), así que
-- este archivo no declara alcance. `003_locations.sql` sí.
--
-- LO QUE SÍ QUEDA DECLARADO AL SALIR SON LAS DOS PLANTAS, y no una: el trigger
-- `site_audit` agrega cada planta recién insertada a `app.site_ids` para poder
-- escribir su entrada en la cadena, que lleva RLS con FORCE. Hasta la migración
-- 0027 ese `set_config` PISABA el valor entero, así que la segunda fila de este
-- INSERT tapaba la declaración de la primera y el archivo terminaba con un
-- alcance que nadie eligió. No rompía nada porque `scripts/seed.mjs` corre un
-- archivo por transacción y los de abajo declaran el suyo; era una trampa
-- esperando a un seed que insertara una planta y después escribiera filas con
-- alcance de sitio.

INSERT INTO site (id, code, name)
VALUES
  ('5717e900-0000-4000-8000-000000000001', 'st-thomas', 'St. Thomas'),
  ('5717e900-0000-4000-8000-000000000002', 'glencoe', 'Glencoe')
ON CONFLICT (code) DO NOTHING;
