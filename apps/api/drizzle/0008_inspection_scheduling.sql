-- Requisitos §4 — InspecciónProgramada, y ADR-005 — el primer trabajo de pg-boss.
--
-- Hasta acá el sistema sabe QUÉ preguntar (plantilla, versión, motor de
-- formularios) y QUIÉN puede preguntarlo (persona, cuenta, rol, alcance), pero no
-- sabe que hay que preguntarlo. Esta migración crea la obligación: "St. Thomas debe
-- una inspección de agosto, contra la versión 2, y le toca a fulano".
--
-- LA PROPIEDAD QUE ESTA MIGRACIÓN DEFIENDE. La versión de plantilla queda congelada
-- al programar. Publicar la v3 no puede mover una inspección abierta contra la v2 —
-- y no porque nadie escriba ese UPDATE, sino porque el UPDATE falla. Eso son dos
-- barreras: el GRANT por columna, que frena a hs_app con 42501, y el trigger de
-- guarda, que frena también a hs_migrator, que es dueño y por lo tanto siempre
-- podría.
--
-- Las tres tablas son PARCIALMENTE mutables, así que NO llevan `hs_make_immutable`:
-- llevan el patrón de `location` (0004 §3) y de `person` (0005 §5). Lo mutable es
-- minúsculo y está enumerado en los GRANT del final.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.
--
-- SQLSTATEs, en el mismo espacio 'HS' que las anteriores:
--   HS001  columna congelada / hecho que no se deshace (reusado de 0001 y 0005)

-- ---------------------------------------------------------------------------
-- 1. El destino de la FK compuesta hacia `template_version`.
--
-- `scheduled_inspection` guarda `template_id` además de `template_version_id`, y esa
-- denormalización tiene que ser defendible por el motor: sin esto, una fila podría
-- afirmar que inspecciona la plantilla A contra una versión de la B, y el único
-- parcial del §3 —que agrupa por `template_id`— estaría agrupando una mentira.
--
-- Redundante como restricción —`id` ya es PK— y necesaria igual: Postgres exige un
-- único sobre las columnas exactas para poder ser destino de una FK compuesta. Es el
-- mismo truco que `location_site_id_uq` en 0004.
--
-- ADD CONSTRAINT sobre una tabla inmutable es legal: `hs_make_immutable` bloquea DML
-- (UPDATE, DELETE, TRUNCATE), no DDL. Ninguna fila se toca. Precedente en 0005.
ALTER TABLE template_version
  ADD CONSTRAINT template_version_id_template_uq UNIQUE (id, template_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `inspection_schedule` — la regla de recurrencia.
--
-- Qué plantilla debe inspeccionarse mensualmente en qué planta. Es la tabla que lee
-- el trabajo de apertura, y existe porque "apertura mensual automática por sitio" sin
-- regla no tiene entrada: el trabajo tendría que decidir por su cuenta qué plantillas
-- le corresponden a cada planta.
--
-- La alternativa que NO se toma es abrir una ocurrencia por cada plantilla activa con
-- versión publicada. No necesita tabla nueva y es exactamente por eso que está mal:
-- convierte cualquier plantilla en una obligación mensual por el solo hecho de
-- existir, y el día que se cargue una plantilla de auditoría anual el sistema empieza
-- a reclamarla todos los meses.
--
-- Sin columna de frecuencia. La mensualidad está en el nombre del período y en el
-- trabajo. El día que haya semanal, ese change agrega la columna; inventarla hoy
-- sería una columna con un solo valor posible.
CREATE TABLE inspection_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),
  template_id uuid NOT NULL REFERENCES template (id),

  -- A quién le toca por default. Nulable: una regla puede existir antes de que el
  -- coordinador decida quién la ejecuta, y en ese caso la ocurrencia nace sin
  -- inspector y él la asigna. La validación de rol y alcance del inspector es del
  -- servicio, no del motor: depende de `user_site_scope`, que cambia con el tiempo,
  -- y una FK no sabe expresar "y además su alcance vigente incluye este sitio".
  default_inspector_id uuid REFERENCES app_user (id),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nulable por el mismo motivo que `audit_log.actor_user_id`: una regla sembrada
  -- por `seeds/` no tiene cuenta detrás.
  created_by uuid REFERENCES app_user (id),

  -- Nunca DELETE. Una regla desactivada deja de abrir períodos nuevos y todas las
  -- inspecciones que ya abrió siguen siendo válidas.
  deactivated_at timestamptz
);

--> statement-breakpoint

-- Una sola regla activa por planta y plantilla. Parcial: permite volver a crear la
-- regla de una plantilla que se había desactivado, sin chocar con la vieja. Mismo
-- criterio que `location_site_active_name_uq` y `user_site_scope_active_uq`.
CREATE UNIQUE INDEX inspection_schedule_active_uq
  ON inspection_schedule (site_id, template_id)
  WHERE deactivated_at IS NULL;

--> statement-breakpoint

-- La consulta del trabajo: las reglas activas, por planta.
CREATE INDEX inspection_schedule_active_idx
  ON inspection_schedule (site_id)
  WHERE deactivated_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `scheduled_inspection` — la ocurrencia del período.
--
-- SIN COLUMNA DE ESTADO, y es deliberado. "Cumplida" se va a derivar de la
-- existencia de una `inspection` enviada, en el change de captura. Poner hoy un
-- `status` sería inventar una máquina de estados que nadie puede hacer avanzar, y
-- que el change siguiente tendría que migrar.
--
-- COPIA `template_id` e `inspector_id` en vez de leerlos por join a la regla, y no
-- lleva FK a la regla: desactivar una regla o cambiarle el inspector por defecto no
-- puede alterar retroactivamente qué se inspeccionó ni contra qué. La regla es una
-- fábrica, no un padre.
CREATE TABLE scheduled_inspection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- El período, como FECHA CIVIL y no como instante. El primer día del mes que
  -- cubre.
  --
  -- El CHECK es `EXTRACT` y no `date_trunc('month', period_start) = period_start`, y
  -- la diferencia importa: `date_trunc(unknown, date)` resuelve por el tipo preferido
  -- de la categoría datetime, que es `timestamptz`, y esa sobrecarga es STABLE — un
  -- CHECK con una función STABLE lo rechaza el motor. `EXTRACT(day FROM date)` es
  -- IMMUTABLE y dice lo mismo.
  period_start date NOT NULL CHECK (EXTRACT(day FROM period_start) = 1),

  -- Generada y no almacenada aparte: guardar el fin como columna independiente
  -- abriría la puerta a una fila con inicio y fin inconsistentes, que es un estado
  -- que ningún código produce a propósito y que igual aparece. Generada, febrero de
  -- un año bisiesto no puede estar mal.
  period_end date GENERATED ALWAYS AS
    ((period_start + INTERVAL '1 month' - INTERVAL '1 day')::date) STORED,

  template_id uuid NOT NULL REFERENCES template (id),

  -- LA COLUMNA DE ESTE CHANGE. Se fija al programar y no se mueve nunca más.
  template_version_id uuid NOT NULL REFERENCES template_version (id),

  -- Nulable: el trabajo la abre con el inspector por defecto de la regla, que puede
  -- no haber. El coordinador asigna después.
  inspector_id uuid REFERENCES app_user (id),

  scheduled_at timestamptz NOT NULL DEFAULT now(),

  -- NULL es el trabajo automático. Es lo que distingue, en la propia tabla, lo que
  -- abrió el calendario de lo que programó el coordinador a mano.
  scheduled_by uuid REFERENCES app_user (id),

  -- Nunca DELETE. Cancelar es esto, y exige motivo.
  cancelled_at timestamptz,
  cancellation_reason text,

  CONSTRAINT scheduled_inspection_cancellation_check
    CHECK ((cancelled_at IS NULL) = (cancellation_reason IS NULL)),

  CONSTRAINT scheduled_inspection_reason_not_blank
    CHECK (cancellation_reason IS NULL OR btrim(cancellation_reason) <> ''),

  -- La versión tiene que ser DE ESTA plantilla. Contra el único del §1.
  CONSTRAINT scheduled_inspection_version_template_fk
    FOREIGN KEY (template_version_id, template_id)
    REFERENCES template_version (id, template_id)
);

--> statement-breakpoint

-- LA GARANTÍA DE IDEMPOTENCIA DE LA APERTURA MENSUAL, y vive acá y no en el trabajo.
--
-- Con esto, dos réplicas del proceso de API que arrancan el mismo cron convergen, un
-- reintento de pg-boss tras un fallo parcial no duplica, y una ejecución manual para
-- recuperar un día caído es segura. El trabajo inserta con ON CONFLICT DO NOTHING y
-- cuenta las filas devueltas; no lleva bookkeeping propio, que bajo concurrencia no
-- garantizaría nada.
--
-- Es sobre `template_id` y NO sobre `template_version_id`: si fuera sobre la versión,
-- publicar la v3 a mitad de mes permitiría abrir una segunda inspección del mismo
-- período, que es exactamente lo que el congelamiento quiere impedir.
--
-- Parcial: una inspección cancelada libera el período para volver a programarlo.
CREATE UNIQUE INDEX scheduled_inspection_open_period_uq
  ON scheduled_inspection (site_id, template_id, period_start)
  WHERE cancelled_at IS NULL;

--> statement-breakpoint

-- La pantalla de inicio del miembro del JHSC: lo mío, no cancelado, por vencimiento.
CREATE INDEX scheduled_inspection_pending_idx
  ON scheduled_inspection (inspector_id, period_end)
  WHERE cancelled_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `notification` — la bandeja.
--
-- ADR-011 design D9: no hay servidor de correo y no se agrega uno. La notificación
-- al coordinador de HS es in-app o no es nada.
--
-- `kind` lleva un CHECK con UN SOLO valor hoy, y eso es honesto: dice que la lista
-- está cerrada y que agregar un tipo es una migración. Es lo que corresponde cuando
-- el consumidor tiene que saber leer el payload.
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES app_user (id),

  -- Una notificación es contenido operativo de una planta: lleva política RLS.
  site_id uuid NOT NULL REFERENCES site (id),

  kind text NOT NULL CHECK (kind IN ('inspection_period_opened')),

  -- La clave de deduplicación DEL PRODUCTOR. Para la apertura del período es
  -- `<site_id>:<period_start>`. Con el único de abajo, "una segunda corrida no
  -- notifica dos veces" lo resuelve la base y no un SELECT previo del handler, que
  -- bajo concurrencia no resuelve nada.
  dedupe_key text NOT NULL CHECK (btrim(dedupe_key) <> ''),

  payload jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Lo ÚNICO que una notificación cambia en toda su vida.
  read_at timestamptz,

  CONSTRAINT notification_dedupe_uq UNIQUE (user_id, kind, dedupe_key)
);

--> statement-breakpoint

-- La bandeja: las mías, no leídas primero, más recientes primero.
CREATE INDEX notification_inbox_idx ON notification (user_id, read_at NULLS FIRST, created_at DESC);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. La guarda. La segunda barrera, la que alcanza también a hs_migrator.
--
-- El GRANT por columna del §9 frena a hs_app con 42501. Este trigger frena a
-- CUALQUIER rol —el dueño incluido, que por serlo siempre podría— con HS001. Sin la
-- segunda barrera, "parcialmente mutable" quiere decir, en la práctica, "entera".
--
-- Un trigger compartido por las tres tablas, resuelto por jsonb: el acceso directo a
-- las columnas no compilaría para las tres, porque no tienen las mismas.
CREATE OR REPLACE FUNCTION hs_scheduling_guard()
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
  frozen := CASE TG_TABLE_NAME
    WHEN 'inspection_schedule' THEN
      ARRAY['id', 'site_id', 'template_id', 'created_at', 'created_by']
    WHEN 'scheduled_inspection' THEN
      ARRAY['id', 'site_id', 'period_start', 'template_id', 'template_version_id',
            'scheduled_at', 'scheduled_by']
    WHEN 'notification' THEN
      ARRAY['id', 'user_id', 'site_id', 'kind', 'dedupe_key', 'payload', 'created_at']
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
            HINT = 'Cancel the record and register a new one instead.';
  END IF;

  -- Los dos hechos que no se deshacen, leídos por jsonb y NO por `OLD.columna`.
  --
  -- No es estilo: plpgsql resuelve el acceso a un campo de record en tiempo de
  -- EJECUCIÓN y evalúa la condición entera como una sola consulta, así que
  -- `TG_TABLE_NAME = 'notification' AND OLD.read_at IS NOT NULL` NO corta antes de
  -- tocar `read_at`. Sobre `scheduled_inspection` —que no tiene esa columna— eso
  -- aborta el UPDATE con "record old has no field read_at", y el trigger compartido
  -- rompe las tres tablas en lugar de proteger a una.
  --
  -- Una cancelación no se deshace: una inspección no se "des-cancela", se programa de
  -- nuevo y quedan las dos filas. La incomodidad es deliberada — es lo que un
  -- inspector del MLITSD tiene que poder leer.
  IF TG_TABLE_NAME = 'scheduled_inspection'
     AND old_row ->> 'cancelled_at' IS NOT NULL
     AND new_row ->> 'cancelled_at' IS NULL THEN
    RAISE EXCEPTION
      'a cancelled inspection cannot be reopened'
      USING ERRCODE = 'HS001',
            HINT = 'Schedule the period again instead of clearing the cancellation.';
  END IF;

  -- Leer tampoco se deshace. Marcar como no leída sería reescribir un hecho.
  IF TG_TABLE_NAME = 'notification'
     AND old_row ->> 'read_at' IS NOT NULL
     AND new_row ->> 'read_at' IS NULL THEN
    RAISE EXCEPTION
      'a notification cannot be marked unread'
      USING ERRCODE = 'HS001';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER inspection_schedule_guard
  BEFORE UPDATE ON inspection_schedule
  FOR EACH ROW EXECUTE FUNCTION hs_scheduling_guard();

--> statement-breakpoint

CREATE TRIGGER scheduled_inspection_guard
  BEFORE UPDATE ON scheduled_inspection
  FOR EACH ROW EXECUTE FUNCTION hs_scheduling_guard();

--> statement-breakpoint

CREATE TRIGGER notification_guard
  BEFORE UPDATE ON notification
  FOR EACH ROW EXECUTE FUNCTION hs_scheduling_guard();

--> statement-breakpoint

-- Se reusa `hs_forbid_mutation()` de 0001 en lugar de escribir otro: es el mismo
-- hecho. Nunca DELETE, en ninguna de las tres.
CREATE TRIGGER inspection_schedule_forbid_deletion
  BEFORE DELETE ON inspection_schedule
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER inspection_schedule_forbid_truncate
  BEFORE TRUNCATE ON inspection_schedule
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER scheduled_inspection_forbid_deletion
  BEFORE DELETE ON scheduled_inspection
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER scheduled_inspection_forbid_truncate
  BEFORE TRUNCATE ON scheduled_inspection
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER notification_forbid_deletion
  BEFORE DELETE ON notification
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER notification_forbid_truncate
  BEFORE TRUNCATE ON notification
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Auditoría de la programación.
--
-- Se reusa `hs_identity_audit_entry(site, kind, body)` de 0005: pese al nombre, es el
-- append genérico al log —resuelve el actor desde `app.user_id` y deja el hash al
-- trigger de la cadena— y escribir un segundo idéntico sería duplicar el mecanismo.
--
-- No hace falta el chequeo de `hs_declared_sites()` que sí hacen los triggers de
-- cuenta: estas tablas SÍ llevan política RLS, así que una fila que llegó hasta acá
-- ya pasó por el WITH CHECK y su sitio está declarado por construcción.
CREATE OR REPLACE FUNCTION hs_scheduled_inspection_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'scheduled_inspection_id', NEW.id,
    'site_id', NEW.site_id,
    'period_start', NEW.period_start,
    'period_end', NEW.period_end,
    'template_id', NEW.template_id,
    'template_version_id', NEW.template_version_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.scheduled',
      body || jsonb_build_object(
        'inspector_id', NEW.inspector_id,
        -- NULL cuando la abrió el calendario. El log tiene que poder separar lo
        -- automático de lo que decidió una persona.
        'scheduled_by', NEW.scheduled_by));

    RETURN NULL;
  END IF;

  -- Una entrada por hecho, no una entrada mezclada: reasignar y cancelar son dos
  -- hechos distintos y el reporte los lee por separado.
  IF NEW.inspector_id IS DISTINCT FROM OLD.inspector_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.reassigned',
      body || jsonb_build_object(
        'previous_inspector_id', OLD.inspector_id,
        'inspector_id', NEW.inspector_id));
  END IF;

  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.cancelled',
      body || jsonb_build_object(
        'cancelled_at', NEW.cancelled_at,
        'cancellation_reason', NEW.cancellation_reason));
  END IF;

  -- Un UPDATE que no cambia nada observable no escribe nada: el log registra
  -- hechos, no sentencias.
  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER scheduled_inspection_audit
  AFTER INSERT OR UPDATE ON scheduled_inspection
  FOR EACH ROW EXECUTE FUNCTION hs_scheduled_inspection_audit();

--> statement-breakpoint

CREATE OR REPLACE FUNCTION hs_inspection_schedule_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  body jsonb;
BEGIN
  body := jsonb_build_object(
    'inspection_schedule_id', NEW.id,
    'site_id', NEW.site_id,
    'template_id', NEW.template_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.created',
      body || jsonb_build_object('default_inspector_id', NEW.default_inspector_id));

    RETURN NULL;
  END IF;

  IF NEW.default_inspector_id IS DISTINCT FROM OLD.default_inspector_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection_schedule.inspector_changed',
      body || jsonb_build_object(
        'previous_default_inspector_id', OLD.default_inspector_id,
        'default_inspector_id', NEW.default_inspector_id));
  END IF;

  IF NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id,
      CASE WHEN NEW.deactivated_at IS NULL
           THEN 'inspection_schedule.reactivated'
           ELSE 'inspection_schedule.deactivated' END,
      body || jsonb_build_object('deactivated_at', NEW.deactivated_at));
  END IF;

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER inspection_schedule_audit
  AFTER INSERT OR UPDATE ON inspection_schedule
  FOR EACH ROW EXECUTE FUNCTION hs_inspection_schedule_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Aislamiento por sitio.
--
-- ADR-002 / ADR-004: lo aplica la política, nunca un WHERE en el endpoint. Sin
-- alcance declarado, ninguna de las tres devuelve una sola fila — y ese es el default
-- correcto, no un bug.
SELECT hs_apply_site_isolation('inspection_schedule');

--> statement-breakpoint

SELECT hs_apply_site_isolation('scheduled_inspection');

--> statement-breakpoint

SELECT hs_apply_site_isolation('notification');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Los privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` ya conceden SELECT e INSERT sobre
-- todo lo que cree hs_migrator. Se repite explícito, como en 0005: leer esta sección
-- tiene que alcanzar para saber qué puede hacer la aplicación, sin ir a buscar otro
-- archivo.
GRANT SELECT, INSERT ON inspection_schedule, scheduled_inspection, notification TO hs_app;

--> statement-breakpoint

-- LA LISTA COMPLETA DE LO MUTABLE. Todo lo que no está acá es inmutable para hs_app
-- por privilegio, y para todos por el trigger del §5.
--
-- `template_version_id` NO está, y esa ausencia es el requisito entero de este
-- change: la versión queda congelada al programar.
GRANT UPDATE (inspector_id, cancelled_at, cancellation_reason)
  ON scheduled_inspection TO hs_app;

--> statement-breakpoint

GRANT UPDATE (default_inspector_id, deactivated_at) ON inspection_schedule TO hs_app;

--> statement-breakpoint

GRANT UPDATE (read_at) ON notification TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. El esquema de pg-boss.
--
-- ADR-005: el planificador corre sobre la misma Postgres y no hay Redis. Sus tablas
-- las crea la propia librería; acá se prepara el terreno.
--
-- LAS TABLAS DE `pgboss` QUEDAN FUERA DEL RÉGIMEN DE INMUTABILIDAD Y FUERA DEL
-- AISLAMIENTO POR SITIO, A PROPÓSITO. Son infraestructura: una cola cuyas filas no se
-- pueden actualizar no es una cola, y un trabajo no pertenece a una planta. Este
-- comentario existe para que la ausencia de `hs_make_immutable` acá se lea como
-- decisión y no como olvido.
--
-- El split de roles: hs_migrator es dueño del esquema y lo instala
-- (`pnpm db:jobs:install`, que corre el plan de construcción de pg-boss); hs_app solo
-- encola y consume. Un proceso de larga vida conectado con el rol dueño evadiría toda
-- política RLS del sistema por la vía de FORCE, y convertiría cualquier bug de un
-- handler en una escritura sin restricciones.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION hs_migrator;

--> statement-breakpoint

GRANT USAGE ON SCHEMA pgboss TO hs_app;

--> statement-breakpoint

-- Se fijan ANTES de que la librería cree nada: los default privileges no son
-- retroactivos. Si el orden se invirtiera, hs_app no podría tocar la cola y el
-- síntoma sería un worker que arranca y no consume nunca.
--
-- Acá sí van UPDATE y DELETE, que en `public` son la excepción que se concede tabla
-- por tabla. Ver el comentario de arriba: es otro régimen, no una filtración de este.
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hs_app;

--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO hs_app;

--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO hs_app;
