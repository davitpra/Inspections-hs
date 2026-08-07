-- ADR-002 / ADR-004 — El mecanismo de inmutabilidad, definido una sola vez.
--
-- Esta migración no crea ninguna tabla: solo funciones. Aplicarla sobre una base
-- con datos es inocua.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- Función trigger: la segunda barrera de la inmutabilidad.
--
-- El REVOKE de `hs_make_immutable` alcanza para hs_app, pero no para hs_migrator:
-- es dueño de las tablas y por lo tanto puede modificarlas siempre. El trigger es
-- la única barrera que aplica a *cualquier* rol, y por eso existe.
--
-- SQLSTATE 'HS001' es propio del proyecto. Que no sea 42501 es lo que permite
-- distinguir "te frenó el privilegio" de "te frenó el trigger" — la prueba de que
-- las dos barreras están puestas, y no una sola.
--
-- El mensaje va en inglés: no es un comentario de código, es texto que puede
-- terminar en un log que lee otra persona.
CREATE OR REPLACE FUNCTION hs_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION
    'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'HS001',
          HINT = 'Records are never modified or removed; write a new entry instead.';
END;
$fn$;

--> statement-breakpoint

-- Vuelve inmutable una tabla: trigger por fila para UPDATE/DELETE, trigger por
-- sentencia para TRUNCATE (TRUNCATE no dispara triggers de fila), y el REVOKE
-- explícito a hs_app.
--
-- El REVOKE es redundante con los default privileges de `db/init/01-roles.sql`
-- —que ya no otorgan UPDATE ni DELETE—. Se hace igual: los default privileges son
-- un default, y alguna migración futura va a conceder UPDATE sobre alguna tabla
-- mutable. El REVOKE deja la intención escrita en la migración de la tabla que sí
-- debe ser inmutable.
CREATE OR REPLACE FUNCTION hs_make_immutable(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- regclass::text ya viene calificado por schema y con comillas si hacen falta.
  ident text := target::text;
  prefix text := replace(ident, '.', '_');
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %s'
    ' FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation()',
    prefix || '_forbid_mutation', ident);

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON %s'
    ' FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation()',
    prefix || '_forbid_truncate', ident);

  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM hs_app', ident);
END;
$fn$;

--> statement-breakpoint

-- Aísla una tabla por sitio. El alcance lo declara la transacción con
-- `SET LOCAL app.site_ids`, nunca un WHERE en el endpoint.
--
-- `current_setting('app.site_ids', true)` devuelve NULL cuando nadie declaró
-- alcance, y `= ANY(NULL)` no matchea nada: sin contexto no se ve nada, que es el
-- default correcto. El mismo predicado va en WITH CHECK, así que un INSERT fuera
-- del alcance también se rechaza.
--
-- FORCE no es opcional: sin él hs_migrator —dueño de la tabla— evade sus propias
-- políticas.
CREATE OR REPLACE FUNCTION hs_apply_site_isolation(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  ident text := target::text;
  policy_name text := replace(ident, '.', '_') || '_site_isolation';
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', ident);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ident);

  EXECUTE format($policy$
    CREATE POLICY %I ON %s
      FOR ALL
      USING (site_id = ANY (
        string_to_array(current_setting('app.site_ids', true), ',')::uuid[]))
      WITH CHECK (site_id = ANY (
        string_to_array(current_setting('app.site_ids', true), ',')::uuid[]))
  $policy$, policy_name, ident);
END;
$fn$;
