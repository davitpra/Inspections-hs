-- La primera cuenta: el coordinador de HS, con alcance a las dos plantas.
--
-- POR QUÉ EXISTE. Toda cuenta de este sistema la crea el coordinador por invitación
-- (ADR-011: sin auto-registro). La primera no puede: no hay coordinador todavía.
-- Este seed es lo único que rompe el huevo y la gallina, y sin él el change de auth
-- no tiene a quién invitar.
--
-- SIN CREDENCIALES, y eso no es un olvido. `app_user` no tiene columna de
-- contraseña: la cuenta existe con su persona, su rol y su alcance, y no puede
-- iniciar sesión hasta que el change de auth le agregue una credencial. Un seed que
-- sembrara una contraseña conocida sería una puerta abierta en cada entorno donde se
-- corran los seeds.
--
-- IDEMPOTENTE. `pnpm db:seed` se corre las veces que haga falta.
--
-- Los ids son literales fijos, por el mismo motivo que en `002_sites.sql`: los
-- fixtures y los tests nombran la cuenta sin una subconsulta, y `app.user_id` se
-- puede declarar sin buscarla primero.

-- ---------------------------------------------------------------------------
-- El alcance de sitio, ANTES de cualquier INSERT.
--
-- `person` lleva `hs_apply_site_isolation`, que hace FORCE ROW LEVEL SECURITY: eso
-- alcanza también a hs_migrator, que es el rol con el que corren los seeds. Sin esta
-- línea, el `WITH CHECK` de la política rechaza el INSERT de la persona con un error
-- que no menciona RLS por ningún lado.
--
-- Hace falta además por una segunda razón, propia de este seed: el trigger diferido
-- `app_user_created_audit` escribe una entrada en la cadena de CADA planta del
-- alcance de la cuenta, y si alguna de esas plantas no estuviera declarada, el
-- trigger frena con HS002.
--
-- `true` es SET LOCAL: muere con la transacción que abre `scripts/seed.mjs` por
-- archivo. Ver el comentario largo de `003_locations.sql`.
SELECT set_config(
  'app.site_ids',
  '5717e900-0000-4000-8000-000000000001,5717e900-0000-4000-8000-000000000002',
  true);

-- ---------------------------------------------------------------------------
-- La persona. Está en el roster como cualquiera de las otras 200: tener cuenta no
-- la hace una clase distinta de persona.
--
-- El número de empleado es de marcador y se corrige con la primera importación real
-- del roster — que, como es un upsert por `employee_number`, va a crear una fila
-- nueva y no a pisar esta. Es la única fila del sistema donde eso puede pasar, y es
-- preferible a inventar un número que después choque contra uno real de ADP.
INSERT INTO person (id, employee_number, first_name, last_name, site_id)
VALUES (
  '7e150000-0000-4000-8000-000000000001',
  'BOOTSTRAP-0001',
  'Health and Safety',
  'Coordinator',
  '5717e900-0000-4000-8000-000000000001')
ON CONFLICT (employee_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- La cuenta. El email se corrige desde la administración —es un UPDATE permitido y
-- queda auditado— antes de mandar la invitación.
INSERT INTO app_user (id, person_id, email, role)
VALUES (
  'acc00000-0000-4000-8000-000000000001',
  '7e150000-0000-4000-8000-000000000001',
  'coordinator@example.com',
  'coordinator')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- El alcance: las dos plantas. §6 pregunta cerrada 5 — solo coordinador y gerencia
-- ven las dos.
--
-- Va en la MISMA transacción que el INSERT de la cuenta, y tiene que ser así: el
-- trigger de alta de cuenta está diferido a COMMIT justamente para encontrar el
-- alcance ya otorgado. Si el alcance se otorgara en otra transacción, el alta no
-- escribiría ninguna entrada de auditoría — ver el comentario de
-- `hs_account_audit_fanout()` en la migración 0005.
INSERT INTO user_site_scope (user_id, site_id)
SELECT 'acc00000-0000-4000-8000-000000000001', s.id
  FROM site s
 WHERE s.code IN ('st-thomas', 'glencoe')
ON CONFLICT DO NOTHING;
