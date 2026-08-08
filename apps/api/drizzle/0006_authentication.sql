-- ADR-011 — Autenticación y sesiones. Cierra la etapa 2 de requisitos §7
-- ("Sitio, Persona, Usuario, auth, importación CSV del roster"), cuya propiedad a
-- probar es "permisos por sitio verificados con datos reales": con esta migración
-- `app.site_ids` deja de ser un argumento del llamador y pasa a derivarse de quién
-- inició sesión.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`. Regenerarla se llevaría puesto todo
-- lo que sigue —triggers, GRANT por columna, fan-out de auditoría, política de
-- ventana— y la migración quedaría siendo cuatro CREATE TABLE.
--
-- SQLSTATE que usa:
--   HS001  el trigger frenó la sentencia (alcanza a hs_migrator, que es dueño)
--   HS002  la administración toca un sitio fuera del alcance declarado (de 0005)
--   42501  el privilegio frenó la sentencia antes de que el trigger corriera
--
-- QUÉ NO HACE ESTA MIGRACIÓN, y es deliberado: no le agrega ninguna columna a
-- `app_user`. El spike de este change verificó que better-auth resuelve la cuenta
-- por email contra `app_user` sin `name`, `email_verified`, `image` ni
-- `updated_at` — las declara requeridas solo para los caminos en que él inserta o
-- actualiza al usuario, y acá nunca lo hace: las cuentas las crea el coordinador y
-- el alta de credencial es la aceptación de una invitación, no un `signUp`. El
-- requisito de que el nombre viva una sola vez, en `person`, queda intacto.

-- ---------------------------------------------------------------------------
-- 1. La credencial.
--
-- El modelo `account` de better-auth apunta acá (design D2). Se llama
-- `app_credential` y no `account` porque en este proyecto "cuenta" ya significa
-- `app_user`, y dos significados para la misma palabra en el mismo esquema es una
-- deuda que se paga en cada lectura.
--
-- `password` es el nombre de la columna que better-auth escribe y lee; guarda el
-- hash scrypt de la librería, nunca la contraseña (design D14). El nombre lo
-- impone él y no se mapea a `password_hash` para no tener que recordar la
-- traducción en cada sitio donde se lea el esquema.
CREATE TABLE app_credential (
  -- text y no uuid: los ids de las filas que inserta better-auth los genera él.
  id text PRIMARY KEY,

  -- Del modelo de better-auth. Para el proveedor `credential` valen el id de la
  -- cuenta y la constante 'credential' respectivamente.
  account_id text NOT NULL,
  provider_id text NOT NULL,

  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE NO ACTION,

  -- Columnas del modelo que solo usan los proveedores OAuth. Se crean porque
  -- better-auth las nombra en sus consultas; quedan nulas para siempre mientras
  -- ADR-011 mantenga SSO fuera de alcance.
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,

  password text,

  -- El bloqueo por intentos fallidos (design D8). En memoria sería más rápido y se
  -- perdería en cada reinicio; con la base ya en el camino del login no hay nada
  -- que ganar. El umbral y la duración viven en el código, no acá: son política.
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- better-auth la reescribe en cada UPDATE suyo. Está en la lista de mutables del
  -- guard por eso y no porque el dominio la use.
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Revocar es esto. Una credencial revocada se conserva: el reinicio de contraseña
  -- es revocar y emitir una invitación nueva (design D9), y el rastro de que hubo
  -- una credencial antes es parte del registro.
  revoked_at timestamptz,

  CONSTRAINT app_credential_failed_attempts_check CHECK (failed_attempts >= 0)
);

--> statement-breakpoint

-- Una cuenta tiene como mucho UNA credencial activa. Parcial, porque las revocadas
-- se acumulan y no deben chocar entre sí ni con la vigente.
CREATE UNIQUE INDEX app_credential_active_uq
  ON app_credential (user_id) WHERE revoked_at IS NULL;

--> statement-breakpoint

-- El lookup de better-auth al verificar la contraseña.
CREATE INDEX app_credential_user_id_idx ON app_credential (user_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. La invitación.
--
-- Tabla del proyecto, no de better-auth: el ciclo que pide ADR-011 —emitida por el
-- coordinador, con vencimiento, de un solo uso, revocable— es una regla de negocio
-- propia y no el flujo de invitación de organizaciones que trae la librería.
--
-- El token se guarda HASHEADO, por el mismo motivo que el de refresh: una base
-- robada no debe dar acceso. El valor en claro se muestra una sola vez, en la
-- pantalla del coordinador, y viaja por el canal que él elija (design D9).
CREATE TABLE user_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE NO ACTION,

  -- Quién la emitió. Es lo que hace que "el coordinador dio de alta a esta persona"
  -- sea un hecho con nombre y no una afirmación del proceso.
  issued_by_user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE NO ACTION,

  token_hash text NOT NULL UNIQUE,

  issued_at timestamptz NOT NULL DEFAULT now(),

  -- Las 72 horas de design D9 las fija el contrato Zod y no un CHECK acá: el motor
  -- no distingue "no lo pusiste" de "pusiste 72", que es el mismo razonamiento por
  -- el que 0005 dejó el default de 30 días del auditor en el contrato.
  expires_at timestamptz NOT NULL,

  accepted_at timestamptz,
  revoked_at timestamptz,

  CONSTRAINT user_invitation_window_check CHECK (expires_at > issued_at),

  -- Una invitación aceptada no se revoca y una revocada no se acepta. Sin esto los
  -- dos estados terminales podrían convivir en la misma fila y "¿cuál ganó?" no
  -- tendría respuesta.
  CONSTRAINT user_invitation_single_outcome_check
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

--> statement-breakpoint

-- Una cuenta no puede tener dos invitaciones vivas: si tuviera, revocar una
-- dejaría acceso abierto por la otra y el coordinador no tendría cómo saberlo.
CREATE UNIQUE INDEX user_invitation_pending_uq
  ON user_invitation (user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. El segundo factor.
--
-- Obligatorio para hs_coordinator y management, opcional para el resto (ADR-011).
-- La obligatoriedad NO vive acá: es una propiedad del par (rol, existencia de fila
-- confirmada) que resuelve el guard en cada request (design D7). Un CHECK que la
-- expresara tendría que mirar `app_user.role` desde otra tabla, que es justamente
-- lo que un CHECK no puede hacer.
CREATE TABLE app_two_factor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE NO ACTION,

  -- El secreto TOTP. Nunca se devuelve después de la confirmación: la única vez que
  -- sale de acá es en la respuesta de inscripción, para que el titular lo cargue.
  secret text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Inscrito no es confirmado. Una fila con `confirmed_at` nulo es un secreto
  -- emitido que todavía no probó nada; el rol obligatorio sigue sin acceso pleno
  -- hasta que devuelva un código válido.
  confirmed_at timestamptz,

  -- Un reinicio del coordinador es esto más una fila nueva, nunca un UPDATE del
  -- secreto: el secreto anterior es un hecho del registro tanto como el nuevo.
  revoked_at timestamptz
);

--> statement-breakpoint

CREATE UNIQUE INDEX app_two_factor_active_uq
  ON app_two_factor (user_id) WHERE revoked_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. La sesión.
--
-- La inserta better-auth, con exactamente las columnas que conoce. Todo lo que le
-- agregamos TIENE que ser anulable o traer default, porque su INSERT no lo nombra:
-- `purpose` trae default y `revoked_at` es anulable. Una columna nuestra con
-- NOT NULL y sin default rompería cada login con una violación de not-null, y es la
-- razón por la que el refresh vive en su propia tabla (design D6).
--
-- El token de acceso es OPACO y se resuelve contra esta tabla en cada request; no
-- es un JWT autocontenido (design D3). Un JWT firmado con el alcance adentro se
-- valida sin tocar la base, y esa es justamente la propiedad que no sirve acá: el
-- alcance quedaría congelado hasta que el token expire, y revocarle una planta a
-- alguien tendría un retraso igual a la vida del token.
CREATE TABLE app_session (
  id text PRIMARY KEY,

  -- El token que viaja. better-auth lo genera y lo compara por igualdad; no está
  -- hasheado porque es él quien lo consulta y no expone un punto donde podríamos
  -- hashearlo sin reescribir su adaptador. La compensación es que la tabla no lleva
  -- ningún otro secreto y que el refresh —el que sí sobrevive días— sí va hasheado.
  token text NOT NULL UNIQUE,

  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE NO ACTION,

  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  ip_address text,
  user_agent text,

  -- Design D7. Una sesión 'enrol_two_factor' es la que recibe un hs_coordinator o
  -- un management que todavía no inscribió su segundo factor: el guard la acepta en
  -- dos rutas y la rechaza en todas las demás.
  purpose text NOT NULL DEFAULT 'full',

  revoked_at timestamptz,
  revoked_reason text,

  CONSTRAINT app_session_purpose_check
    CHECK (purpose IN ('full', 'enrol_two_factor'))
);

--> statement-breakpoint

-- La revocación en masa: desactivar una cuenta, vencerla, revocarle la credencial o
-- reiniciarle el segundo factor recorre este índice.
CREATE INDEX app_session_live_idx ON app_session (user_id) WHERE revoked_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. El refresh.
--
-- Tabla propia y no columnas de `app_session`, por dos motivos (design D6): la
-- sesión la inserta better-auth y no puede recibir una columna NOT NULL que él no
-- conoce; y la rotación es de N a 1 — una sesión emite muchos refresh a lo largo de
-- su vida y la unidad que se revoca sigue siendo la sesión.
--
-- Acá el hash sí es innegociable: este token vive 14 días (la ventana de
-- sincronización de ADR-010 más un margen igual) y es lo único que le permite a un
-- dispositivo que estuvo una semana sin señal volver a autenticarse.
CREATE TABLE app_refresh_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id text NOT NULL REFERENCES app_session (id) ON DELETE NO ACTION,

  token_hash text NOT NULL UNIQUE,

  -- La cadena de rotación. Reusar un token gastado revoca la cadena entera, porque
  -- un refresh usado dos veces significa que existe una copia.
  parent_id uuid REFERENCES app_refresh_token (id) ON DELETE NO ACTION,

  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  -- Gastado en la rotación. `replaced_by_id` es lo que permite devolver el MISMO
  -- par dentro de la ventana de gracia de 60 segundos (design D6) en lugar de
  -- expulsar a un cliente cuya red se cortó entre el refresh y la respuesta.
  spent_at timestamptz,
  replaced_by_id uuid REFERENCES app_refresh_token (id) ON DELETE NO ACTION,

  revoked_at timestamptz,

  CONSTRAINT app_refresh_token_window_check CHECK (expires_at > issued_at)
);

--> statement-breakpoint

CREATE INDEX app_refresh_token_session_idx ON app_refresh_token (session_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. `app_verification`.
--
-- El modelo `verification` de better-auth existe para el material de un solo uso de
-- sus flujos: verificación de email, reinicio de contraseña por link, OTP. ADR-011
-- deja los tres fuera de alcance y design D9 explica por qué no hay correo
-- transaccional, así que en este sistema esa tabla no recibiría nunca una fila.
--
-- Se crea igual, y con una sola razón: better-auth la consulta al arrancar algunos
-- de sus caminos internos, y una relación inexistente falla con 42P01 en runtime en
-- vez de en el arranque — que es el peor momento para enterarse. Queda vacía.
CREATE TABLE app_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX app_verification_identifier_idx ON app_verification (identifier);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Mutabilidad parcial: el guard que alcanza a CUALQUIER rol.
--
-- Mismo patrón que `hs_identity_guard()` de 0005 §7 y que `location` de 0004: el
-- GRANT por columna frena a hs_app con 42501, y este trigger frena a hs_migrator
-- —dueño de las tablas, y por lo tanto siempre capaz— con HS001. Sin la segunda
-- barrera, "parcialmente mutable" quiere decir "entera".
--
-- Se escribe una función nueva en vez de extender el CASE de `hs_identity_guard()`
-- para no tocar una función que ya tiene tres tablas probadas colgando.
CREATE OR REPLACE FUNCTION hs_auth_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  offending text;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  frozen text[];
  col text;
BEGIN
  -- Por jsonb y no por acceso directo porque es un trigger compartido por cinco
  -- tablas con columnas distintas: `NEW.token` no compilaría para `app_credential`.
  frozen := CASE TG_TABLE_NAME
    -- Mutable: failed_attempts, locked_until, updated_at, revoked_at.
    WHEN 'app_credential' THEN ARRAY[
      'id', 'account_id', 'provider_id', 'user_id', 'password', 'created_at']

    -- Mutable: accepted_at, revoked_at. Una invitación no cambia de destinatario,
    -- de emisor, de token ni de vencimiento — se revoca y se emite otra.
    WHEN 'user_invitation' THEN ARRAY[
      'id', 'user_id', 'issued_by_user_id', 'token_hash', 'issued_at', 'expires_at']

    -- Mutable: confirmed_at, revoked_at. El secreto nunca se pisa.
    WHEN 'app_two_factor' THEN ARRAY['id', 'user_id', 'secret', 'created_at']

    -- Mutable: expires_at, updated_at, revoked_at, revoked_reason. `updated_at`
    -- está en la lista de mutables porque better-auth la reescribe en cada UPDATE
    -- suyo, y `expires_at` porque su sesión deslizante la extiende.
    WHEN 'app_session' THEN ARRAY['id', 'token', 'user_id', 'purpose', 'created_at']

    -- Mutable: spent_at, replaced_by_id, revoked_at.
    WHEN 'app_refresh_token' THEN ARRAY[
      'id', 'session_id', 'token_hash', 'parent_id', 'issued_at', 'expires_at']
  END;

  FOREACH col IN ARRAY frozen LOOP
    IF old_row ->> col IS DISTINCT FROM new_row ->> col THEN
      offending := col;
      EXIT;
    END IF;
  END LOOP;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'column %.% is assigned once and cannot be changed', TG_TABLE_NAME, offending
      USING ERRCODE = 'HS001',
            HINT = 'Revoke the record and register a new one instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_credential_guard
  BEFORE UPDATE ON app_credential
  FOR EACH ROW EXECUTE FUNCTION hs_auth_guard();

--> statement-breakpoint

CREATE TRIGGER user_invitation_guard
  BEFORE UPDATE ON user_invitation
  FOR EACH ROW EXECUTE FUNCTION hs_auth_guard();

--> statement-breakpoint

CREATE TRIGGER app_two_factor_guard
  BEFORE UPDATE ON app_two_factor
  FOR EACH ROW EXECUTE FUNCTION hs_auth_guard();

--> statement-breakpoint

CREATE TRIGGER app_session_guard
  BEFORE UPDATE ON app_session
  FOR EACH ROW EXECUTE FUNCTION hs_auth_guard();

--> statement-breakpoint

CREATE TRIGGER app_refresh_token_guard
  BEFORE UPDATE ON app_refresh_token
  FOR EACH ROW EXECUTE FUNCTION hs_auth_guard();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Nada se borra.
--
-- Una sesión se revoca, una credencial se revoca, una invitación se revoca. El
-- DELETE no es un camino más lento: no existe.
--
-- ADVERTENCIA, y es el hallazgo del spike de este change: better-auth EMITE
-- `DELETE` sobre `app_session` al cerrar sesión, y cuando el motor se lo frena
-- responde `200 {"success":true}` igual — registra el error como interno y le dice
-- al cliente que cerró la sesión, dejando la fila viva y el token sirviendo. Estos
-- triggers son por lo tanto la red de abajo y NO la barrera principal: la barrera
-- es el hook `databaseHooks.session.delete.before` del módulo de autenticación, que
-- intercepta el DELETE, escribe `revoked_at` y devuelve `false` para que la
-- sentencia no llegue a emitirse (design D15). Si alguien quita ese hook, estos
-- triggers siguen impidiendo el borrado — lo que no pueden dar es el error visible.
CREATE TRIGGER app_credential_forbid_deletion
  BEFORE DELETE ON app_credential
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER user_invitation_forbid_deletion
  BEFORE DELETE ON user_invitation
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_two_factor_forbid_deletion
  BEFORE DELETE ON app_two_factor
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_session_forbid_deletion
  BEFORE DELETE ON app_session
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_refresh_token_forbid_deletion
  BEFORE DELETE ON app_refresh_token
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- `app_verification` es la excepción y es coherente: es la única tabla del change
-- que guarda material efímero de un solo uso, no un hecho del registro. Se le deja
-- el DELETE a better-auth porque su limpieza es lo correcto para esa tabla. Queda
-- vacía de todos modos (§6).

-- ---------------------------------------------------------------------------
-- 9. TRUNCATE.
CREATE TRIGGER app_credential_forbid_truncate
  BEFORE TRUNCATE ON app_credential
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER user_invitation_forbid_truncate
  BEFORE TRUNCATE ON user_invitation
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_two_factor_forbid_truncate
  BEFORE TRUNCATE ON app_two_factor
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_session_forbid_truncate
  BEFORE TRUNCATE ON app_session
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_refresh_token_forbid_truncate
  BEFORE TRUNCATE ON app_refresh_token
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Sin política RLS, por el mismo razonamiento de 0005 §10.
--
-- `app_user` y `user_site_scope` quedaron sin política porque una política sobre el
-- alcance que se lee PARA CONSTRUIR el alcance es un arranque circular. Vale igual
-- para las cinco tablas de acá: el guard las lee antes de que exista alcance
-- alguno, en el request donde todavía no se sabe quién está del otro lado.
--
-- CONSECUENCIA DECLARADA: cualquier rol conectado puede leer la tabla de sesiones.
-- Lo que el motor sí niega es el DELETE sobre las cinco y el UPDATE sobre toda
-- columna fuera de los GRANT de §11. Y el token de refresh —el único que sobrevive
-- días— está hasheado, así que leer la tabla no da sesiones renovables.

-- ---------------------------------------------------------------------------
-- 11. Privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` conceden SELECT e INSERT sobre
-- toda tabla nueva. Lo que hace falta declarar es el UPDATE, ACOTADO POR COLUMNA:
-- cualquier otra la frena el motor con 42501 sin que el trigger llegue a correr.
GRANT UPDATE (failed_attempts, locked_until, updated_at, revoked_at)
  ON app_credential TO hs_app;

--> statement-breakpoint

GRANT UPDATE (accepted_at, revoked_at) ON user_invitation TO hs_app;

--> statement-breakpoint

GRANT UPDATE (confirmed_at, revoked_at) ON app_two_factor TO hs_app;

--> statement-breakpoint

GRANT UPDATE (expires_at, updated_at, revoked_at, revoked_reason)
  ON app_session TO hs_app;

--> statement-breakpoint

GRANT UPDATE (spent_at, replaced_by_id, revoked_at) ON app_refresh_token TO hs_app;

--> statement-breakpoint

-- `app_verification` es la única con UPDATE y DELETE completos, por lo que dice §6:
-- es material efímero de better-auth, no un hecho del registro.
GRANT UPDATE, DELETE ON app_verification TO hs_app;

--> statement-breakpoint

GRANT SELECT, INSERT ON
  app_credential, user_invitation, app_two_factor,
  app_session, app_refresh_token, app_verification
  TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 12. Auditoría de la autenticación.
--
-- Reusa `hs_account_audit_fanout()` de 0005 §8 sin inventar nada: un hecho sobre una
-- cuenta no pertenece a un sitio, `audit_log.site_id` es NOT NULL, y esa función ya
-- resuelve exactamente ese problema escribiendo el evento en la cadena de CADA sitio
-- del alcance de la cuenta.
--
-- Los eventos que dejan fila van por TRIGGER, porque un trigger sobre la fila es
-- imposible de olvidar. Los que no dejan fila —login exitoso, login fallido,
-- bloqueo— no tienen dónde colgarlo y los escribe la función de §13, llamada dentro
-- de la transacción del login.
CREATE OR REPLACE FUNCTION hs_credential_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'credential.created',
      jsonb_build_object('account_id', NEW.user_id, 'credential_id', NEW.id));

    RETURN NULL;
  END IF;

  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'credential.revoked',
      jsonb_build_object(
        'account_id', NEW.user_id,
        'credential_id', NEW.id,
        'revoked_at', NEW.revoked_at));
  END IF;

  -- El bloqueo por intentos fallidos es un hecho que el coordinador tiene que poder
  -- ver: es la señal de que alguien está probando contra una cuenta real.
  IF NEW.locked_until IS DISTINCT FROM OLD.locked_until AND NEW.locked_until IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'auth.locked_out',
      jsonb_build_object(
        'account_id', NEW.user_id,
        'failed_attempts', NEW.failed_attempts,
        'locked_until', NEW.locked_until));
  END IF;

  -- Un UPDATE que solo incrementa el contador no escribe nada: el fallo individual
  -- lo registra §13, con su categoría de motivo. Escribirlo también acá duplicaría
  -- cada intento fallido en las dos cadenas.
  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_credential_audit
  AFTER INSERT OR UPDATE ON app_credential
  FOR EACH ROW EXECUTE FUNCTION hs_credential_audit();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_invitation_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb := jsonb_build_object(
    'account_id', NEW.user_id,
    'invitation_id', NEW.id,
    'issued_by_user_id', NEW.issued_by_user_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'invitation.issued',
      body || jsonb_build_object('expires_at', NEW.expires_at));

    RETURN NULL;
  END IF;

  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at AND NEW.accepted_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'invitation.accepted',
      body || jsonb_build_object('accepted_at', NEW.accepted_at));
  END IF;

  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'invitation.revoked',
      body || jsonb_build_object('revoked_at', NEW.revoked_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

-- El alta va DIFERIDA a COMMIT por el mismo motivo que el alta de cuenta de 0005:
-- la invitación del bootstrap se emite en la misma transacción que crea la cuenta y
-- su alcance, y un AFTER INSERT normal encontraría el alcance vacío.
CREATE CONSTRAINT TRIGGER user_invitation_audit
  AFTER INSERT OR UPDATE ON user_invitation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_invitation_audit();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_two_factor_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb := jsonb_build_object('account_id', NEW.user_id, 'two_factor_id', NEW.id);
BEGIN
  -- El INSERT no se audita: un secreto emitido y no confirmado no cambió nada de lo
  -- que la cuenta puede hacer. El hecho auditable es la confirmación.
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  END IF;

  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at AND NEW.confirmed_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'two_factor.enrolled',
      body || jsonb_build_object('confirmed_at', NEW.confirmed_at));
  END IF;

  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'two_factor.reset',
      body || jsonb_build_object('revoked_at', NEW.revoked_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_two_factor_audit
  AFTER INSERT OR UPDATE ON app_two_factor
  FOR EACH ROW EXECUTE FUNCTION hs_two_factor_audit();

--> statement-breakpoint

-- La revocación de una sesión sí deja fila y por lo tanto va por trigger. El alta
-- NO se audita como evento propio: el hecho "inició sesión" lo escribe §13 con su
-- contexto, y hacerlo también acá pondría dos entradas por login.
CREATE OR REPLACE FUNCTION hs_session_revoked_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
    PERFORM hs_account_audit_fanout(
      NEW.user_id, 'session.revoked',
      jsonb_build_object(
        'account_id', NEW.user_id,
        'session_id', NEW.id,
        'reason', NEW.revoked_reason));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_session_revoked_audit
  AFTER UPDATE ON app_session
  FOR EACH ROW EXECUTE FUNCTION hs_session_revoked_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 13. Los eventos de autenticación que no dejan fila.
--
-- Login exitoso, login fallido y —cuando el caller la usa— cualquier otra cosa que
-- pase sin escribir una fila propia. La llama la API dentro de la transacción del
-- login, y por eso no puede ser un trigger.
--
-- El `payload` NO lleva nunca la contraseña, su hash ni el código TOTP: el caller
-- pasa una categoría de motivo, no lo que se tecleó. Un secreto en una tabla
-- append-only no se puede sacar después.
CREATE OR REPLACE FUNCTION hs_auth_event(account_id uuid, kind text, body jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF kind NOT IN ('auth.signed_in', 'auth.signed_out', 'auth.sign_in_failed') THEN
    RAISE EXCEPTION 'unknown authentication event type %', kind
      USING ERRCODE = 'HS001',
            HINT = 'Events that leave a row are audited by their own trigger.';
  END IF;

  IF body ?| ARRAY['password', 'password_hash', 'secret', 'code', 'token'] THEN
    RAISE EXCEPTION 'authentication event payload must not carry a secret'
      USING ERRCODE = 'HS001',
            HINT = 'Record a reason category, never what was typed.';
  END IF;

  PERFORM hs_account_audit_fanout(account_id, kind, body);
END;
$fn$;

--> statement-breakpoint

-- La lectura del auditor externo: la ÚNICA lectura que este sistema registra.
--
-- Riesgo I de §5 y ADR-011. La escribe `withSiteScope` dentro de la MISMA
-- transacción que la lectura (design D10), y por eso tampoco puede ser un trigger:
-- un SELECT no dispara triggers, que es exactamente el motivo por el que "auditar
-- lecturas" no es gratis en ningún sistema.
--
-- Una entrada por sitio alcanzado, porque una lectura que cruza las dos plantas es
-- un hecho de cada una. El `payload` lleva qué se leyó y la ventana que la sesión
-- tenía vigente: sin la ventana, "el auditor vio 40 hallazgos" no dice de qué
-- período, y el registro no responde la pregunta que le van a hacer.
CREATE OR REPLACE FUNCTION hs_auditor_read_event(target_site uuid, body jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT (body ? 'resource') THEN
    RAISE EXCEPTION 'an auditor read event must name the resource that was read'
      USING ERRCODE = 'HS001';
  END IF;

  PERFORM hs_identity_audit_entry(target_site, 'auditor.read', body);
END;
$fn$;

--> statement-breakpoint

-- CONSECUENCIA DECLARADA: un intento fallido contra un email que no existe NO
-- escribe ninguna entrada, y no es un hueco. No hay cuenta a la que atribuirlo ni
-- alcance del que sacar un sitio, y `audit_log.site_id` es NOT NULL; además, una
-- dirección tecleada mal en una tabla append-only no se puede sacar después. Esos
-- intentos se cuentan igual para el bloqueo, por IP y en memoria (design D8).

-- ---------------------------------------------------------------------------
-- 14. La ventana de fechas del auditor externo.
--
-- `records_from` y `records_to` existen desde 0005 con su CHECK. Lo que faltaba es
-- que ACOTEN. La forma coherente con ADR-004 es la misma que el aislamiento por
-- sitio: settings de transacción que fija `withSiteScope` desde la sesión, y una
-- política por tabla.
--
-- Sin los settings declarados, la política no acota nada: es lo que hace que una
-- sesión que no es de auditor no cambie de comportamiento. Es el criterio inverso al
-- de `hs_apply_site_isolation`, donde sin alcance declarado no se ve nada, y la
-- diferencia es correcta: el default de un alcance es "ninguno", el default de una
-- ventana es "toda la historia".
--
-- La política se crea RESTRICTIVE, y eso es lo único que hace que la ventana sea una
-- ventana. Dos políticas PERMISIVAS sobre el mismo comando se combinan con OR: la
-- ventana ensancharía en vez de recortar, y una fila fuera del período pero dentro
-- del alcance pasaría igual. RESTRICTIVE se combina con AND.
--
-- PRECONDICIÓN: la tabla ya tiene una política permisiva —en la práctica, la de
-- `hs_apply_site_isolation`—. Postgres exige al menos una permisiva para dejar pasar
-- una fila, así que una tabla que solo tuviera esta no devolvería nada. Toda tabla
-- que un auditor pueda leer está aislada por sitio, así que la precondición se
-- cumple sola; queda escrita para el change que algún día encuentre la excepción.
-- Los dos bordes de la ventana, como funciones y no como expresiones dentro de la
-- política. La diferencia no es de estilo y costó un test: escrito como
-- `nullif(current_setting(...), '') IS NULL OR col >= current_setting(...)::date`, el
-- planificador NO garantiza evaluar el `OR` en orden, y el cast de la cadena vacía a
-- `date` revienta con `invalid input syntax for type date: ""`.
--
-- Y la cadena vacía aparece siempre: un GUC personalizado que alguna transacción de
-- esa conexión fijó con `SET LOCAL` no vuelve a estar indefinido al terminar — vuelve
-- a `''`. Bajo pooling, eso es todas las conexiones después del primer auditor.
--
-- Adentro de una función el guard se evalúa una sola vez y el cast solo corre cuando
-- hay algo que castear.
CREATE OR REPLACE FUNCTION hs_record_window_from()
RETURNS date
LANGUAGE sql
STABLE
AS $fn$
  SELECT nullif(current_setting('app.records_from', true), '')::date;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_record_window_to()
RETURNS date
LANGUAGE sql
STABLE
AS $fn$
  SELECT nullif(current_setting('app.records_to', true), '')::date;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_apply_record_window(target regclass, date_column text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  ident text := target::text;
  policy_name text := replace(ident, '.', '_') || '_record_window';
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', ident);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ident);

  EXECUTE format($policy$
    CREATE POLICY %I ON %s
      AS RESTRICTIVE
      FOR ALL
      USING (
        (hs_record_window_from() IS NULL OR %I >= hs_record_window_from())
        AND
        (hs_record_window_to() IS NULL OR %I < hs_record_window_to() + 1))
      WITH CHECK (true)
  $policy$, policy_name, ident, date_column, date_column);
END;
$fn$;

--> statement-breakpoint

-- Hoy tiene un solo consumidor, y no por falta de ganas: las tablas que un auditor
-- externo va a querer leer —inspecciones, hallazgos, incidentes— son de las etapas 3
-- a 6 y todavía no existen. `audit_log` es la única con fecha de registro que ya
-- está, y es justamente la que tiene sentido que lea.
--
-- CADA change que cree una tabla legible por el auditor tiene que pasarla por este
-- helper. Escribir el mecanismo ahora y aplicarlo a una sola tabla es más barato que
-- descubrir en la etapa 6 que la ventana era un WHERE repetido en siete endpoints.
--
-- `audit_log` cumple la precondición: lleva `hs_apply_site_isolation` desde 0002.
--
-- Se acota por `occurred_at` —cuándo pasó el hecho— y no por `recorded_at` —cuándo
-- llegó al servidor—: la ventana que el coordinador le concede a un auditor es sobre
-- el período que puede revisar, y una inspección de marzo sincronizada en abril
-- pertenece a marzo. Es el mismo criterio del riesgo C de §5.
--
-- El borde superior es `< records_to + 1 día` y no `<= records_to`: `occurred_at` es
-- timestamptz y `records_to` es date, así que `<=` dejaría afuera todo lo ocurrido
-- después de la medianoche del último día — una ventana que termina el 31 no
-- incluiría el 31.
--
-- CUIDADO, y esto lo encontró un test: mientras la ventana esté declarada, NADA puede
-- escribir en `audit_log` en esa misma transacción. El trigger de la cadena de 0002
-- calcula `seq` con un `SELECT max(seq)` que la política también filtra, así que con
-- una ventana de 2020 puesta ve cero filas, asigna `seq = 1` y choca contra el único
-- `(site_id, seq)`. Por eso `withSessionScope` LIMPIA los dos settings antes de
-- escribir la entrada de lectura del auditor: la ventana acota lo que se lee, y la
-- entrada que registra esa lectura no es una lectura.
SELECT hs_apply_record_window('audit_log', 'occurred_at');
