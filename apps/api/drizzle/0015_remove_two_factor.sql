-- Change `remove-two-factor-for-mvp` — SE QUITA EL SEGUNDO FACTOR DEL ALCANCE DEL MVP.
--
-- `0006_authentication.sql` construyó el TOTP obligatorio para `hs_coordinator` y
-- `management` con su design D7: una cuenta sin segundo factor confirmado recibe una
-- sesión de `purpose = 'enrol_two_factor'`, que el guard acepta únicamente en las rutas
-- de inscripción. Del lado del servidor funciona exactamente como fue escrito.
--
-- Lo que nunca se construyó es la otra mitad: **no hay pantalla de inscripción**. Las
-- rutas `POST /auth/two-factor/enrol` y `/confirm` no tienen ningún consumidor en
-- `apps/web`, así que la sesión limitada no tiene salida y el coordinador de bootstrap
-- —la primera cuenta del sistema, la que crea todas las demás— no puede usar el sistema.
-- Completar la funcionalidad es trabajo sobre una superficie que §2 no pidió para v1;
-- el MVP la deja afuera entera.
--
-- ESTA ES LA PRIMERA MIGRACIÓN DEL PROYECTO QUE ELIMINA UNA TABLA, y conviene decir por
-- qué es aceptable acá. `app_two_factor` es inmutable por `hs_make_immutable`, pero esa
-- inmutabilidad protege el REGISTRO, y el registro no vive en ella: **el hecho auditable
-- —`two_factor.enrolled`, `two_factor.reset`— lo escribió `hs_two_factor_audit()` en
-- `audit_log`, encadenado por sitio, y esta migración no lo toca.** Las entradas que
-- existan siguen ahí y la cadena sigue verificando. Lo que se pierde son los secretos
-- TOTP, que es precisamente lo que no conviene conservar sin código que los use: un
-- secreto que ya no autentica nada sigue siendo un secreto que hay que custodiar.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA: el bloqueo por intentos fallidos
-- (`app_credential.failed_attempts`, `locked_until` y sus GRANT), la rotación del
-- refresh, las invitaciones, el aislamiento por sitio y el hasheo de contraseñas. El
-- único factor que se va es el segundo.
--
-- ORDEN DE LAS SENTENCIAS: no hay dependencias reales entre ellas —el `CASE` de
-- `hs_auth_guard()` compara literales de texto, no referencias a columnas— pero se
-- escriben de mayor a menor alcance para que se lean como lo que son: primero muere la
-- tabla, después su función de auditoría, después se corrige el guard compartido, y al
-- final se limpia la columna que sostenía la sesión limitada.

-- ---------------------------------------------------------------------------
-- 1. La tabla.
--
-- Sus cuatro triggers (`_guard`, `_forbid_deletion`, `_forbid_truncate`, `_audit`), su
-- índice parcial `app_two_factor_active_uq` y sus GRANT caen con ella. Las barreras de
-- `hs_make_immutable` son triggers de FILA —BEFORE UPDATE, DELETE y TRUNCATE—, no event
-- triggers de DDL, así que ninguna se opone a un DROP; el proyecto no define ningún
-- event trigger.

DROP TABLE app_two_factor;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Su función de auditoría.
--
-- No cae con la tabla: el trigger que la invocaba sí, la función no. Emitía
-- `two_factor.enrolled` al confirmarse una inscripción y `two_factor.reset` al
-- revocarse, ambas por `hs_account_audit_fanout`. Sin tabla que la dispare, queda como
-- código muerto dentro del motor.

DROP FUNCTION hs_two_factor_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. El guard compartido, reemitido.
--
-- ESTA ES LA PARTE DELICADA DE LA MIGRACIÓN. `hs_auth_guard()` es UNA función que
-- sirve a cinco tablas y decide qué columnas están congeladas con un `CASE
-- TG_TABLE_NAME`. No hay forma de quitarle una rama parcialmente: se reemite entera.
--
-- Y si al reescribirla se perdiera o se alterara la rama de OTRA tabla, esa tabla
-- quedaría mutable **sin producir ningún error** —el fallo no sería una excepción sino
-- la ausencia de una—. Por eso lo que sigue es el cuerpo literal de `0006` §7 con
-- exactamente dos cambios: se borra la rama `WHEN 'app_two_factor'` y sale `'purpose'`
-- del arreglo de `app_session`. Las ramas de `app_credential`, `user_invitation` y
-- `app_refresh_token` están intactas, carácter por carácter.

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
  -- Por jsonb y no por acceso directo porque es un trigger compartido por cuatro
  -- tablas con columnas distintas: `NEW.token` no compilaría para `app_credential`.
  frozen := CASE TG_TABLE_NAME
    -- Mutable: failed_attempts, locked_until, updated_at, revoked_at.
    WHEN 'app_credential' THEN ARRAY[
      'id', 'account_id', 'provider_id', 'user_id', 'password', 'created_at']

    -- Mutable: accepted_at, revoked_at. Una invitación no cambia de destinatario,
    -- de emisor, de token ni de vencimiento — se revoca y se emite otra.
    WHEN 'user_invitation' THEN ARRAY[
      'id', 'user_id', 'issued_by_user_id', 'token_hash', 'issued_at', 'expires_at']

    -- Mutable: expires_at, updated_at, revoked_at, revoked_reason. `updated_at`
    -- está en la lista de mutables porque better-auth la reescribe en cada UPDATE
    -- suyo, y `expires_at` porque su sesión deslizante la extiende.
    WHEN 'app_session' THEN ARRAY['id', 'token', 'user_id', 'created_at']

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

-- ---------------------------------------------------------------------------
-- 4. La columna que sostenía la sesión limitada.
--
-- Sin `purpose`, toda sesión resuelta es plena y no hay sesiones de segunda clase. El
-- CHECK se dropea primero porque nombra la columna.

ALTER TABLE app_session DROP CONSTRAINT app_session_purpose_check;

--> statement-breakpoint

ALTER TABLE app_session DROP COLUMN purpose;
