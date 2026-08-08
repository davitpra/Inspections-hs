-- Requisitos §4 ("La distinción central: Persona ≠ Usuario") y §6 pregunta cerrada 3
-- ("el roster es importación por archivo, no sincronización con ADP"). Cierra la
-- segunda mitad de la etapa 2 de §7.
--
-- El segundo dolor de Atlas es que agregar a alguien al roster exige darle una
-- cuenta. Todo lo que sigue existe para que eso sea imposible de reintroducir: una
-- `person` es un registro del roster y no sabe que las cuentas existen; una cuenta
-- (`app_user`) apunta a una persona y nunca al revés.
--
-- LO QUE ESTA MIGRACIÓN NO TRAE: credenciales. Ni contraseña, ni hash, ni sesión,
-- ni secreto TOTP. ADR-011 elige better-auth dentro de `apps/api` y eso es un
-- change propio. Una cuenta creada acá es una identidad completa —persona, rol,
-- alcance, ciclo de vida— que todavía no puede iniciar sesión, y ese es el estado
-- correcto.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que 0001, 0003 y 0004:
--   HS001  append-only / columna de identidad no modificable (reusado de 0001)
--   HS002  operación de administración sobre un sitio fuera del alcance declarado
--          (nuevo acá: ver §5)

-- ---------------------------------------------------------------------------
-- 1. `person` — el roster.
--
-- 200 y pico de filas, la mayoría sin cuenta y para siempre. Existe para poder ser
-- sujeto de un incidente (R4) o responsable de una acción correctiva (R3) sin que
-- eso implique darle acceso a nadie.
CREATE TABLE person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La identidad, y es el número de empleado de ADP, no el nombre (§4). Estable e
  -- inmutable: el mismo número es la misma persona aunque cambien el apellido y la
  -- planta, y es lo que hace que la importación pueda ser un upsert.
  employee_number text NOT NULL CHECK (employee_number ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),

  -- El nombre NO identifica. Dos personas activas pueden llamarse igual y las dos
  -- filas son legítimas; el selector las distingue por `employee_number`. Editable:
  -- corregir un apellido mal tipeado no puede exigir una fila nueva.
  first_name text NOT NULL CHECK (btrim(first_name) <> ''),
  last_name text NOT NULL CHECK (btrim(last_name) <> ''),

  -- La planta donde trabaja. Obligatoria: es lo que hace que el selector de sujeto
  -- de un supervisor de St. Thomas ofrezca personas de St. Thomas (§6 pregunta 5).
  --
  -- MUTABLE, a diferencia de `location.site_id`. La diferencia es física: una
  -- ubicación no se muda de planta, una persona sí. Si fuera inmutable, transferir
  -- a alguien exigiría una segunda fila con el mismo `employee_number` —que choca
  -- contra el único— o un número inventado, que parte el historial de la persona
  -- justo donde tiene que estar entero.
  site_id uuid NOT NULL REFERENCES site (id),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nunca DELETE. Una persona que se fue queda referenciada en incidentes y
  -- acciones inmutables: desaparece del selector y sigue resolviendo desde el
  -- historial.
  deactivated_at timestamptz,

  CONSTRAINT person_employee_number_uq UNIQUE (employee_number)
);

--> statement-breakpoint

-- NO lleva `UNIQUE (site_id, id)`, y es a propósito.
--
-- `location` sí lo lleva, para que toda tabla con ubicación pueda declarar
-- `FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)` y una
-- inspección de St. Thomas con una ubicación de Glencoe sea un error de FK. Con
-- `person` esa FK compuesta sería un error: congela el par (sitio, fila) para
-- siempre, y `person.site_id` es mutable. Transferir a alguien invalidaría
-- retroactivamente todos los incidentes que lo nombran —o peor, con
-- ON UPDATE CASCADE los reescribiría, que es exactamente lo que un registro
-- inmutable no puede permitir.
--
-- Un incidente de St. Thomas de 2026 tiene que seguir diciendo "el sujeto fue esta
-- persona" aunque en 2027 esa persona trabaje en Glencoe. Las tablas de las etapas
-- 4 a 6 referencian `person (id)` a secas, y la garantía de que el selector solo
-- ofrece gente del sitio es de SELECCIÓN —la política RLS de más abajo—, no
-- estructural.

-- La lectura real es "las personas activas de este sitio, en orden de apellido":
-- es exactamente el selector de sujeto.
CREATE INDEX person_site_active_name_idx
  ON person (site_id, last_name, first_name)
  WHERE deactivated_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `app_user` — la cuenta.
--
-- Se llama `app_user` y no `user` por dos motivos. `user` es palabra reservada en
-- Postgres: `CREATE TABLE user` no compila y toda referencia posterior tendría que
-- ir entre comillas para siempre, lo cual se olvida exactamente una vez y rompe
-- una migración. Y better-auth (ADR-011) crea su propio conjunto de tablas, donde
-- `user` es el nombre por defecto de una: dejarlo libre evita resolver la colisión
-- bajo presión en el change de auth.
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La dirección de la referencia importa. Si fuera `person.user_id`, la persona
  -- tendría una columna que el 92 % del roster deja nula y que insinúa que la
  -- cuenta es parte de ser persona. Con la referencia acá, `person` no sabe que las
  -- cuentas existen — que es exactamente la distinción de §4.
  --
  -- UNIQUE es lo que prohíbe la cuenta compartida y la segunda cuenta "de
  -- administración" de la misma persona. ADR-011 lo pide por nombre: si el
  -- `actor_id` del log no identifica a una persona real, la inmutabilidad no prueba
  -- nada.
  person_id uuid NOT NULL UNIQUE REFERENCES person (id),

  -- La única copia del email en el sistema. Es cómo el coordinador invita a la
  -- cuenta y cómo better-auth va a reconocer a su dueño: se configura para usar
  -- `app_user` como su modelo de usuario y agrega solo lo suyo. Una tabla propia
  -- con su propio email crearía dos verdades sobre la misma dirección y la pregunta
  -- "¿cuál gana?" no tiene respuesta buena.
  --
  -- El único es sobre el valor ya normalizado por `hs_app_user_normalize()`: dos
  -- capitalizaciones del mismo buzón chocan con violación de único, no con un
  -- CHECK. Vale también para las cuentas dadas de baja — el buzón sigue tomado.
  email text NOT NULL UNIQUE CHECK (position('@' in email) > 1 AND email !~ '\s'),

  -- Exactamente UN rol, de un conjunto cerrado (§4, tabla de roles y permisos).
  --
  -- Un rol y no un conjunto: con 15 a 20 usuarios, un conjunto convierte cada
  -- pregunta de permisos en una unión que nadie puede auditar de un vistazo.
  --
  -- CHECK y no `CREATE TYPE ... AS ENUM`: agregar un valor a un enum es fácil, pero
  -- quitarlo o renombrarlo exige recrear el tipo y todas las columnas que lo usan, y
  -- el conjunto de roles es justo lo que se ajusta en la v2. Tampoco tabla `role`
  -- con FK: cinco valores fijos que el código conoce por nombre no ganan nada por
  -- ser filas, y sí pierden — invitan a que alguien cree el sexto sin migración.
  --
  -- `jhsc_member` cierra la nota de vocabulario de §4: "inspector" NO es un rol.
  -- Queda libre para ser `inspection.inspector_id`, que es un campo, no un permiso.
  role text NOT NULL CHECK (
    role IN ('hs_coordinator', 'jhsc_member', 'supervisor', 'management', 'external_auditor')),

  -- Ciclo de vida del auditor externo — §5 riesgo I, cerrado en v1.2, y ADR-011.
  expires_at timestamptz,
  records_from date,
  records_to date,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nunca DELETE. Una cuenta dada de baja sigue resolviendo como `actor_user_id` de
  -- cada entrada que escribió: el registro tiene que seguir diciendo quién actuó.
  deactivated_at timestamptz,

  -- Las cuatro reglas del riesgo I que son restricciones de datos, en el motor y no
  -- en el servicio. Una cuenta de auditor externo es lo único de este sistema que le
  -- da acceso a los registros a alguien de afuera: una regla de servicio se saltea
  -- con un INSERT a mano el día que haya que arreglar algo apurado; un CHECK no.
  --
  -- El default de 30 días es lo único que NO es una restricción sino una sugerencia,
  -- y vive en el contrato Zod: el motor no puede distinguir "no lo pusiste" de
  -- "pusiste 30".
  --
  -- El máximo se mide contra `created_at` y no contra `now()` —un CHECK no puede
  -- usar una función volátil— y la consecuencia es la buscada: una cuenta de auditor
  -- no se puede extender más allá de 90 días desde su creación ni siquiera
  -- renovándola. Renovar es crear una cuenta nueva, con su propio evento de
  -- auditoría. Eso es exactamente "sin renovación automática".
  CONSTRAINT app_user_auditor_lifecycle CHECK (
    (role <> 'external_auditor'
       AND expires_at IS NULL AND records_from IS NULL AND records_to IS NULL)
    OR
    (role = 'external_auditor'
       AND expires_at IS NOT NULL
       AND expires_at > created_at
       AND expires_at <= created_at + interval '90 days'
       AND records_from IS NOT NULL AND records_to IS NOT NULL
       AND records_from <= records_to)
  )
);

--> statement-breakpoint

-- NINGUNA columna de contraseña, hash, salt, token, sesión ni secreto TOTP. No es
-- una omisión: es la línea que separa este change del de auth, y está afirmada por
-- un escenario del spec que inspecciona el esquema.

-- ---------------------------------------------------------------------------
-- 3. `user_site_scope` — el alcance de una cuenta.
--
-- Filas y no un `site_ids uuid[]` en `app_user`. Un arreglo no puede llevar FK
-- —Postgres no referencia elementos de un arreglo—, así que un id inexistente
-- entraría sin error; y quitar un sitio sería sobrescribir la columna, con lo que
-- la revocación no dejaría rastro. Con filas, "quién tenía acceso a Glencoe en
-- marzo" se contesta leyendo la tabla, que es exactamente la auditoría trimestral
-- de roles vs. sitio de operación que pide la tabla de métricas de §2.
CREATE TABLE user_site_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES app_user (id),
  site_id uuid NOT NULL REFERENCES site (id),

  granted_at timestamptz NOT NULL DEFAULT now(),

  -- Revocar es UPDATE de esta columna, nunca DELETE. La invariante del proyecto no
  -- tiene excepciones, y borrar la fila borraría justo el dato que la auditoría
  -- trimestral necesita.
  revoked_at timestamptz,

  CONSTRAINT user_site_scope_window CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

--> statement-breakpoint

-- Único PARCIAL, solo sobre los vigentes: es lo que permite volver a otorgar un
-- sitio revocado sin chocar contra la fila vieja. Mismo patrón que el nombre activo
-- de `location`.
CREATE UNIQUE INDEX user_site_scope_active_uq
  ON user_site_scope (user_id, site_id)
  WHERE revoked_at IS NULL;

--> statement-breakpoint

-- La lectura real es "el alcance vigente de esta cuenta", y la hace cada request
-- para armar `app.site_ids`.
CREATE INDEX user_site_scope_active_idx
  ON user_site_scope (user_id)
  WHERE revoked_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Predicado de cuenta activa.
--
-- "Vencida" es una condición de tiempo, no una columna. Un job de pg-boss que
-- pusiera `deactivated_at` al vencer agregaría una pieza móvil para derivar algo
-- que una comparación ya deriva, y si el job no corre, la cuenta sigue viva —
-- exactamente el fallo que la regla existe para prevenir.
--
-- Se define una sola vez para que no se copie en cada consulta. STABLE y no
-- IMMUTABLE: usa now().
CREATE OR REPLACE FUNCTION hs_account_is_active(account app_user)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT account.deactivated_at IS NULL
     AND (account.expires_at IS NULL OR account.expires_at > now());
$fn$;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Normalización y mutabilidad parcial.
--
-- El email se normaliza en el motor y no en el servicio: si lo normalizara el
-- servicio, la primera vía de escritura alternativa —un seed, un script, una
-- corrección a mano— metería `Sam.Reid@Example.com` y el único no vería el
-- duplicado.
CREATE OR REPLACE FUNCTION hs_app_user_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_user_normalize
  BEFORE INSERT OR UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION hs_app_user_normalize();

--> statement-breakpoint

-- Las tres tablas son PARCIALMENTE mutables, así que no llevan `hs_make_immutable`:
-- llevan el patrón de `location` (0004 §3). El GRANT por columna frena a hs_app con
-- 42501, y este trigger frena a CUALQUIER rol —hs_migrator incluido, que es dueño y
-- por lo tanto siempre podría— con HS001.
--
-- Sin la segunda barrera, "parcialmente mutable" quiere decir, en la práctica,
-- "entera".
CREATE OR REPLACE FUNCTION hs_identity_guard()
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
  -- Las columnas congeladas por tabla. Se resuelve por jsonb porque es un trigger
  -- compartido por tres tablas con columnas distintas y el acceso directo no
  -- compilaría para las tres.
  frozen := CASE TG_TABLE_NAME
    WHEN 'person' THEN ARRAY['id', 'employee_number', 'created_at']
    WHEN 'app_user' THEN ARRAY['id', 'person_id', 'created_at']
    WHEN 'user_site_scope' THEN ARRAY['id', 'user_id', 'site_id', 'granted_at']
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
            HINT = 'Deactivate the record and register a new one instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER person_guard
  BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION hs_identity_guard();

--> statement-breakpoint

CREATE TRIGGER app_user_guard
  BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION hs_identity_guard();

--> statement-breakpoint

CREATE TRIGGER user_site_scope_guard
  BEFORE UPDATE ON user_site_scope
  FOR EACH ROW EXECUTE FUNCTION hs_identity_guard();

--> statement-breakpoint

-- La baja es lógica, y esto es lo que la hace lo ÚNICO que las tres tablas
-- admiten. Se reusa `hs_forbid_mutation()` de 0001 en lugar de escribir otro: es el
-- mismo hecho.
CREATE TRIGGER person_forbid_deletion
  BEFORE DELETE ON person
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER person_forbid_truncate
  BEFORE TRUNCATE ON person
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_user_forbid_deletion
  BEFORE DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER app_user_forbid_truncate
  BEFORE TRUNCATE ON app_user
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER user_site_scope_forbid_deletion
  BEFORE DELETE ON user_site_scope
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER user_site_scope_forbid_truncate
  BEFORE TRUNCATE ON user_site_scope
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Las tablas de la importación del roster.
--
-- §6 pregunta cerrada 3: importación de CSV cuando cambia algo, manual y
-- controlada. El reporte de la importación queda como registro y no solo como
-- salida en pantalla: un reporte que se puede editar no es un reporte, así que las
-- tres son TOTALMENTE inmutables.
--
-- Sin política RLS: un archivo exportado de ADP trae filas de las dos plantas y el
-- lote es uno solo. El desglose por sitio —y el que se audita— es
-- `roster_import_site`.
CREATE TABLE roster_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nullable por el mismo motivo que `audit_log.actor_user_id`: una importación
  -- corrida desde un script de arranque no tiene cuenta detrás.
  imported_by uuid REFERENCES app_user (id),

  source_filename text NOT NULL CHECK (btrim(source_filename) <> ''),

  rows_read int NOT NULL CHECK (rows_read >= 0),
  rows_applied int NOT NULL CHECK (rows_applied >= 0),
  rows_rejected int NOT NULL CHECK (rows_rejected >= 0),

  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),

  -- Que los contadores cierren es una propiedad del reporte, no una esperanza sobre
  -- el importador.
  CONSTRAINT roster_import_counts CHECK (rows_read = rows_applied + rows_rejected)
);

--> statement-breakpoint

-- El desglose por planta. Existe por una razón concreta: `audit_log.site_id` es NOT
-- NULL, así que la entrada de resumen de la importación necesita un sitio, y los
-- contadores de ese sitio tienen que salir de un dato y no de un parámetro que el
-- servicio recuerda pasar. Con esta tabla, la entrada de auditoría la escribe un
-- trigger (§8) sobre una fila que el importador tiene que escribir igual.
CREATE TABLE roster_import_site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_id uuid NOT NULL REFERENCES roster_import (id),
  site_id uuid NOT NULL REFERENCES site (id),

  rows_applied int NOT NULL CHECK (rows_applied >= 0),
  rows_rejected int NOT NULL CHECK (rows_rejected >= 0),

  CONSTRAINT roster_import_site_uq UNIQUE (import_id, site_id)
);

--> statement-breakpoint

-- Una fila por fila rechazada. `row_number` es 1-based sobre el ARCHIVO —incluida
-- la línea de encabezado— porque es el número que el coordinador ve en Excel, que
-- es el único lugar donde va a ir a arreglarlo.
CREATE TABLE roster_import_rejection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_id uuid NOT NULL REFERENCES roster_import (id),

  row_number int NOT NULL CHECK (row_number >= 1),

  -- Nullable: el motivo del rechazo puede ser justamente que la fila no traía uno.
  employee_number text,

  reason text NOT NULL CHECK (btrim(reason) <> ''),

  -- La fila cruda, tal como vino. Sin esto, "fila 47 rechazada por sitio
  -- desconocido" obliga a volver al archivo original, que para entonces puede haber
  -- cambiado.
  raw_row jsonb NOT NULL,

  CONSTRAINT roster_import_rejection_row_uq UNIQUE (import_id, row_number)
);

--> statement-breakpoint

SELECT hs_make_immutable('roster_import');

--> statement-breakpoint

SELECT hs_make_immutable('roster_import_site');

--> statement-breakpoint

SELECT hs_make_immutable('roster_import_rejection');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Auditoría de la identidad, escrita por el motor.
--
-- Mismo razonamiento que `hs_catalog_audit()` en 0004 §4: si la auditoría viviera
-- en el servicio, el hueco aparecería la primera vez que exista una segunda ruta de
-- escritura —el importador, un script, una corrección a mano— y el hueco es
-- invisible: la operación funciona, simplemente no queda registrada.
--
-- El actor sale de `app.user_id`, que ya fija `withSiteScope`. Nulo durante seeds y
-- migraciones, que es lo correcto: no hay usuario detrás.

-- Helper: los sitios del alcance declarado por la transacción. Se usa para verificar
-- que una operación de administración no escribe en la cadena de una planta que la
-- transacción no administra.
CREATE OR REPLACE FUNCTION hs_declared_sites()
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $fn$
  SELECT coalesce(
    string_to_array(nullif(current_setting('app.site_ids', true), ''), ',')::uuid[],
    ARRAY[]::uuid[]);
$fn$;

--> statement-breakpoint

-- Escribe una entrada. `seq`, `prev_hash`, `recorded_at` y `hash` los sobrescribe el
-- trigger de la cadena de 0002: los valores de acá son de relleno para satisfacer el
-- NOT NULL, exactamente igual que los que manda la API.
--
-- El INSERT corre bajo la política RLS de `audit_log` porque la función es SECURITY
-- INVOKER. Para `person` eso es inocuo por el mismo motivo que documenta 0004: si la
-- transacción pudo escribir la fila de esa planta, esa planta está en su alcance.
-- Para `app_user` y `user_site_scope` NO se sostiene —esas tablas no llevan RLS—, y
-- por eso el caller verifica antes y falla con HS002, que dice lo que pasó, en lugar
-- de dejar salir el error de política, que no lo dice.
CREATE OR REPLACE FUNCTION hs_identity_audit_entry(
  target_site uuid, kind text, body jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO audit_log (site_id, actor_user_id, event_type, payload, occurred_at, recorded_at, hash)
  VALUES (
    target_site,
    nullif(current_setting('app.user_id', true), '')::uuid,
    kind,
    body,
    now(), now(), ''::bytea);
END;
$fn$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_person_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'person_id', NEW.id,
    'employee_number', NEW.employee_number);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.created',
      body || jsonb_build_object('first_name', NEW.first_name, 'last_name', NEW.last_name));

    RETURN NULL;
  END IF;

  -- Un UPDATE puede cambiar varias cosas observables a la vez. Se escribe una
  -- entrada por cambio y no una entrada mezclada: renombrar, transferir y dar de
  -- baja son tres hechos distintos y el reporte los lee por separado.
  IF NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.renamed',
      body || jsonb_build_object(
        'previous_first_name', OLD.first_name,
        'previous_last_name', OLD.last_name,
        'first_name', NEW.first_name,
        'last_name', NEW.last_name));
  END IF;

  -- La transferencia se escribe en LAS DOS cadenas: cada planta tiene que poder
  -- mostrar quiénes son su gente, y "se fue a Glencoe" es un hecho de St. Thomas
  -- tanto como de Glencoe.
  IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
    PERFORM hs_identity_audit_entry(
      OLD.site_id, 'person.transferred',
      body || jsonb_build_object('from_site_id', OLD.site_id, 'to_site_id', NEW.site_id));

    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'person.transferred',
      body || jsonb_build_object('from_site_id', OLD.site_id, 'to_site_id', NEW.site_id));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id,
      CASE WHEN NEW.deactivated_at IS NULL THEN 'person.reactivated' ELSE 'person.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  -- Un UPDATE que no cambia nada observable no escribe nada: el log registra
  -- hechos, no sentencias.
  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER person_audit
  AFTER INSERT OR UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION hs_person_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Auditoría de la cuenta y del alcance.
--
-- `audit_log.site_id` es NOT NULL y la cadena es por sitio. Una cuenta no tiene
-- sitio: tiene un alcance, que puede ser de dos. Las tres salidas posibles eran
-- hacer `site_id` nullable —que rompe el encadenado y toca una tabla inmutable en su
-- columna más estructural—, inventar un sitio sintético "de organización" —que
-- ensucia todo lo que agrupa por sitio— o escribir el evento en la cadena de CADA
-- sitio del alcance de la cuenta.
--
-- Se elige la tercera, y no porque sobre: porque dice la verdad. "A esta persona se
-- le dio acceso a St. Thomas el 12 de marzo con rol de supervisor" es un hecho DE
-- St. Thomas, y el registro regulatorio de St. Thomas es donde un inspector del
-- MLITSD lo va a buscar. Que el mismo hecho aparezca en las dos cadenas cuando el
-- alcance es de dos plantas no es duplicación: son dos afirmaciones sobre dos
-- lugares de trabajo distintos.
CREATE OR REPLACE FUNCTION hs_account_audit_fanout(account_id uuid, kind text, body jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  target uuid;
  declared uuid[] := hs_declared_sites();
BEGIN
  FOR target IN
    SELECT s.site_id FROM user_site_scope s
     WHERE s.user_id = account_id AND s.revoked_at IS NULL
     ORDER BY s.site_id
  LOOP
    IF NOT (target = ANY (declared)) THEN
      RAISE EXCEPTION
        'account administration reaches site %, which is outside the declared scope', target
        USING ERRCODE = 'HS002',
              HINT = 'Administering an account requires every site it reaches to be in scope.';
    END IF;

    PERFORM hs_identity_audit_entry(target, kind, body);
  END LOOP;

  -- CONSECUENCIA DECLARADA: una cuenta sin alcance vigente no escribe ninguna
  -- entrada, porque no alcanza ninguna planta y no hay cadena a la que el hecho
  -- pertenezca. No es un hueco — hay un escenario del spec que lo fija. El flujo
  -- normal crea la cuenta y su alcance en la misma transacción, y el evento de
  -- `user.scope_granted` deja el rastro igual.
END;
$fn$;

--> statement-breakpoint

-- El alta es un CONSTRAINT TRIGGER diferido a COMMIT, y esa es la única forma de que
-- funcione: en el momento del INSERT de `app_user` todavía no existe ninguna fila de
-- `user_site_scope` —su FK apunta a la cuenta que se está insertando—, así que un
-- AFTER INSERT normal encontraría el alcance vacío y no escribiría nada. Diferido,
-- corre al final de la transacción, con el alcance ya otorgado.
CREATE OR REPLACE FUNCTION hs_account_created_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM hs_account_audit_fanout(
    NEW.id, 'user.created',
    jsonb_build_object(
      'account_id', NEW.id,
      'person_id', NEW.person_id,
      'email', NEW.email,
      'role', NEW.role,
      'expires_at', NEW.expires_at));

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER app_user_created_audit
  AFTER INSERT ON app_user
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hs_account_created_audit();

--> statement-breakpoint

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

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER app_user_changed_audit
  AFTER UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION hs_account_changed_audit();

--> statement-breakpoint

-- El otorgamiento y la revocación van SOLO a la cadena del sitio otorgado o
-- revocado: es el único que cambia. Que Glencoe registre que a alguien se le dio
-- acceso a St. Thomas no le dice nada a Glencoe.
CREATE OR REPLACE FUNCTION hs_scope_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  account app_user;
  body jsonb;
BEGIN
  IF NOT (NEW.site_id = ANY (hs_declared_sites())) THEN
    RAISE EXCEPTION
      'cannot grant or revoke access to site %, which is outside the declared scope', NEW.site_id
      USING ERRCODE = 'HS002',
            HINT = 'Access to a workplace can only be administered from within its scope.';
  END IF;

  SELECT * INTO account FROM app_user u WHERE u.id = NEW.user_id;

  body := jsonb_build_object(
    'account_id', NEW.user_id,
    'person_id', account.person_id,
    'role', account.role,
    'site_id', NEW.site_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'user.scope_granted',
      body || jsonb_build_object('granted_at', NEW.granted_at));

    RETURN NULL;
  END IF;

  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id,
      CASE WHEN NEW.revoked_at IS NULL THEN 'user.scope_granted' ELSE 'user.scope_revoked' END,
      body || jsonb_build_object('revoked_at', NEW.revoked_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER user_site_scope_audit
  AFTER INSERT OR UPDATE ON user_site_scope
  FOR EACH ROW EXECUTE FUNCTION hs_scope_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Auditoría del resumen de importación.
--
-- Una entrada por planta tocada, con el archivo y los contadores DE ESA PLANTA. La
-- escribe el motor a partir de `roster_import_site`, no el importador: una segunda
-- ruta de importación —un script de migración de datos, por ejemplo— produciría el
-- mismo registro sin acordarse de nada.
CREATE OR REPLACE FUNCTION hs_roster_import_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  batch roster_import;
BEGIN
  SELECT * INTO batch FROM roster_import r WHERE r.id = NEW.import_id;

  PERFORM hs_identity_audit_entry(
    NEW.site_id, 'roster.imported',
    jsonb_build_object(
      'import_id', NEW.import_id,
      'source_filename', batch.source_filename,
      'rows_applied', NEW.rows_applied,
      'rows_rejected', NEW.rows_rejected));

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER roster_import_site_audit
  AFTER INSERT ON roster_import_site
  FOR EACH ROW EXECUTE FUNCTION hs_roster_import_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Aislamiento por sitio.
--
-- `person` es contenido operativo de una planta: quién trabaja acá. Es además la
-- tabla que alimenta el selector de sujeto de un incidente, y §6 pregunta 5 dice que
-- un supervisor de St. Thomas no tiene por qué ver Glencoe.
--
-- El WITH CHECK de la política es, además, lo que acota la transferencia: mover a
-- alguien a otra planta exige tener las dos en el alcance, así que solo el
-- coordinador puede, sin que ningún endpoint lo verifique.
SELECT hs_apply_site_isolation('person');

--> statement-breakpoint

-- `app_user` y `user_site_scope` NO llevan política, y hay que decir por qué.
--
-- `app_user` no tiene un sitio: tiene un alcance, que puede ser de dos. Una política
-- exigiría inventar un predicado sobre la tabla de alcance —"veo las cuentas que
-- comparten al menos una planta conmigo"— que responde una pregunta que nadie hace:
-- la lista de cuentas la administra el coordinador, que tiene las dos de todos
-- modos. Es el mismo razonamiento que dejó a `site` sin política en 0004.
-- `user_site_scope` va con ella, porque una política sobre el alcance que se lee
-- para CONSTRUIR el alcance es un arranque circular.
--
-- CONSECUENCIA DECLARADA: cualquier rol conectado puede leer la lista de cuentas.
-- Que solo el coordinador la administre lo va a exigir el endpoint del change de
-- auth; hasta que ese endpoint exista, la superficie es cero. Lo que esta migración
-- sí niega en el motor es el DELETE sobre las tres tablas y el UPDATE sobre todo lo
-- que no esté en los GRANT de abajo.

-- ---------------------------------------------------------------------------
-- 11. Privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` conceden SELECT e INSERT sobre
-- toda tabla nueva. Lo que hace falta declarar es el UPDATE, y va ACOTADO POR
-- COLUMNA: cualquier otra columna la frena el motor con 42501 sin que el trigger
-- llegue a correr.
GRANT UPDATE (first_name, last_name, site_id, deactivated_at) ON person TO hs_app;

--> statement-breakpoint

GRANT UPDATE (email, role, expires_at, records_from, records_to, deactivated_at)
  ON app_user TO hs_app;

--> statement-breakpoint

-- Lo único mutable de una fila de alcance. Revocar y volver a otorgar son esta
-- columna; todo lo demás es una fila nueva.
GRANT UPDATE (revoked_at) ON user_site_scope TO hs_app;

--> statement-breakpoint

-- DELETE no se concede nunca, sobre ninguna. Las tres tablas de importación ya
-- quedaron sin UPDATE ni DELETE por `hs_make_immutable`.
GRANT SELECT, INSERT ON person, app_user, user_site_scope TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 12. La FK que 0002 dejó anotada.
--
-- `audit_log.actor_user_id` era un uuid sin FK por orden de construcción: la tabla
-- de cuentas no existía. Ya existe. ADR-011 pide que el actor identifique a una
-- persona real o la inmutabilidad no prueba nada.
--
-- Sigue siendo NULLABLE, y eso no es una concesión: seeds, migraciones y eventos de
-- motor no tienen usuario detrás, y una cuenta de servicio compartida para
-- rellenarlo sería exactamente lo que ADR-011 prohíbe.
--
-- ADD CONSTRAINT sobre una tabla inmutable es legal: `hs_make_immutable` bloquea
-- UPDATE, DELETE y TRUNCATE de filas, no DDL del dueño. Y `actor_user_id` ya entra
-- en `hs_audit_canonical` con el mismo valor, así que ningún hash cambia y la
-- verificación de la cadena da lo mismo antes y después de esta migración.
--
-- NO ACTION explícito: una cuenta no se borra, y si alguien lo intentara, la FK
-- tiene que frenarlo.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES app_user (id) ON DELETE NO ACTION;
