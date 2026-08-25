-- Requisitos §4 — El asiento en el JHSC de una cuenta de coordinador.
--
-- POR QUÉ UNA COLUMNA Y NO UN ROL. `0005` §"el rol" fijó cinco valores y la nota de
-- vocabulario de §4: `jhsc_member` es el término único para quien está en el comité, e
-- "inspector" no es un rol. Eso sigue igual. Lo que este archivo agrega es lo que aquella
-- migración dio por supuesto sin decirlo: que estar en el comité y tener el rol son la
-- misma cosa. Para los siete miembros lo son; para la coordinadora no, y como
-- `app_user.person_id` es UNIQUE tampoco existe una segunda cuenta que dárselo.
--
-- El asiento es una POSICIÓN que una cuenta ocupa, no un rol que lleva. Se otorga, se
-- quita, y no cambia nada de lo que la cuenta puede hacer como coordinadora.
--
-- TABLA PARCIALMENTE MUTABLE (ADR-002). `app_user` no tiene UPDATE por default: cada
-- columna mutable se concede a mano en `0005` §11, y `hs_identity_guard` congela `id`,
-- `person_id` y `created_at` contra CUALQUIER rol. Acá se agrega una columna y se concede
-- SU UPDATE, sin tocar ni el guard ni las columnas congeladas: el asiento se toma y se
-- deja, y quedarse fijo sería lo incorrecto.
--
-- SIN política RLS, como toda la tabla: `app_user` no tiene un sitio, tiene un alcance
-- (`0005` §10). La auditoría del asiento sí es por planta, y sale del fanout de siempre.

ALTER TABLE app_user ADD COLUMN jhsc_seat_granted_at timestamptz;

--> statement-breakpoint

-- EL CHECK ES LA GARANTÍA, no el servicio.
--
-- Sin él, esta columna sería una segunda puerta —más silenciosa que el rol— para volver
-- inspeccionable a un `management` o a un `supervisor`, que es exactamente lo que §4 no
-- permite. Con él, "se sienta en el JHSC" tiene dos casos y solo dos, y el segundo no se
-- puede ampliar con un UPDATE a mano.
--
-- Un `jhsc_member` no lleva asiento, y eso no es una omisión: su rol YA es el asiento.
-- Dejarlo llevar la columna crearía el estado ambiguo "miembro con y sin asiento", y la
-- lectura tendría que decidir cuál de los dos datos gana.
ALTER TABLE app_user ADD CONSTRAINT app_user_jhsc_seat_check
  CHECK (jhsc_seat_granted_at IS NULL OR role = 'hs_coordinator');

--> statement-breakpoint

-- El UPDATE de la columna nueva, acotado por columna como el resto de `0005` §11.
GRANT UPDATE (jhsc_seat_granted_at) ON app_user TO hs_app;

--> statement-breakpoint

-- La quinta rama de la auditoría de cambios de cuenta.
--
-- La función se reescribe ENTERA porque `CREATE OR REPLACE` no compone: las cuatro ramas
-- de `0005` §8 están acá tal cual, y la quinta al final.
--
-- Sin esta rama, la coordinadora se otorga a sí misma la posibilidad de recibir
-- inspecciones sin dejar rastro — que es justamente el acto que la auditoría trimestral de
-- §2 querría poder leer. Dos eventos y no uno con un booleano adentro: sentarse y
-- levantarse son hechos distintos y se buscan por separado.
CREATE OR REPLACE FUNCTION hs_account_changed_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb := jsonb_build_object('account_id', NEW.id, 'person_id', NEW.person_id);
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM hs_account_audit_fanout(
      NEW.id, 'user.role_changed',
      body || jsonb_build_object('previous_role', OLD.role, 'role', NEW.role));
  END IF;

  -- Cambiar el email cambia quién puede tomar control de la cuenta. Es un evento.
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    PERFORM hs_account_audit_fanout(
      NEW.id, 'user.email_changed',
      body || jsonb_build_object('previous_email', OLD.email, 'email', NEW.email));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_account_audit_fanout(
      NEW.id,
      CASE WHEN NEW.deactivated_at IS NULL THEN 'user.reactivated' ELSE 'user.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    PERFORM hs_account_audit_fanout(
      NEW.id, 'user.expiry_changed',
      body || jsonb_build_object('previous_expires_at', OLD.expires_at, 'expires_at', NEW.expires_at));
  END IF;

  IF NEW.jhsc_seat_granted_at IS DISTINCT FROM OLD.jhsc_seat_granted_at THEN
    PERFORM hs_account_audit_fanout(
      NEW.id,
      CASE WHEN NEW.jhsc_seat_granted_at IS NULL
           THEN 'user.jhsc_seat_withdrawn' ELSE 'user.jhsc_seat_granted' END,
      body || jsonb_build_object('jhsc_seat_granted_at', NEW.jhsc_seat_granted_at));
  END IF;

  RETURN NULL;
END;
$fn$;
