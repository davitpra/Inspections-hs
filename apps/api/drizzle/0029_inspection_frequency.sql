-- ---------------------------------------------------------------------------
-- 0029 — La frecuencia de la regla de recurrencia.
--
-- 0008 dejó esto anotado y pendiente, con estas palabras:
--
--   «Sin columna de frecuencia. La mensualidad está en el nombre del período y en el
--    trabajo. El día que haya semanal, ese change agrega la columna; inventarla hoy
--    sería una columna con un solo valor posible.»
--
-- Ese día es este, y el problema que resuelve no es cosmético: hoy CUALQUIER plantilla
-- que entre al sistema se vuelve una obligación mensual por el solo hecho de tener una
-- regla. Una auditoría anual no se puede expresar — el trabajo la reclamaría doce veces
-- al año y el reporte que se le entrega al MLITSD declararía once incumplimientos que
-- nadie cometió.
--
-- LA DECISIÓN DE MODELO: el período SE ESTIRA. Una regla trimestral no abre tres
-- inspecciones mensuales, ni una inspección de enero que en realidad cubre el trimestre:
-- abre UNA con `period_start = 2026-01-01` y `period_end = 2026-03-31`. Es lo que hace
-- que `periodStatusCase()` siga siendo correcto sin tocarlo —`open` sigue queriendo decir
-- «el período no cerró»— y lo que hace que `required_count` del reporte diga 4 y no 12.
--
-- LAS FRECUENCIAS SON LOS DIVISORES DE 12, y esa lista no es arbitraria: es exactamente
-- el conjunto para el que un ancla de 1 a 12 alcanza para decidir, sin mirar el año, si
-- un mes empieza período. Con una frecuencia de 5 la respuesta dependería del año y el
-- ancla tendría que ser una fecha absoluta.
--
-- TABLAS INMUTABLES TOCADAS: las dos. `inspection_schedule` y `scheduled_inspection`
-- están bajo el régimen del §5 de 0008, así que las columnas nuevas entran al array
-- `frozen` del trigger de guarda y NO reciben GRANT UPDATE. Ver el §3 de acá abajo.

-- ---------------------------------------------------------------------------
-- 1. La regla: cada cuántos meses, y anclada en cuál.
--
-- EL BACKFILL NO PUEDE ESTAR MAL, y es el motivo de que los DEFAULT estén acá y no en un
-- UPDATE aparte: toda regla que existe hoy es mensual —no había otra cosa— y para una
-- regla mensual el ancla no significa nada, porque `mod 1` es cero para todos los meses.
-- Enero es un valor arbitrario que ninguna lectura puede distinguir de otro.
ALTER TABLE inspection_schedule
  ADD COLUMN frequency_months smallint NOT NULL DEFAULT 1,
  ADD COLUMN anchor_month     smallint NOT NULL DEFAULT 1;

--> statement-breakpoint

-- El default de `anchor_month` se retira una vez backfilleado: un alta nueva tiene que
-- DECIR su ancla, y el servicio la resuelve con el mes civil de Ontario cuando el cliente
-- no la manda. Dejarlo en enero haría que una regla anual creada en septiembre venciera
-- en enero sin que nadie lo haya pedido.
--
-- El de `frequency_months` se queda: mensual es el default del dominio, no un relleno.
ALTER TABLE inspection_schedule
  ALTER COLUMN anchor_month DROP DEFAULT;

--> statement-breakpoint

ALTER TABLE inspection_schedule
  ADD CONSTRAINT inspection_schedule_frequency_check
    CHECK (frequency_months IN (1, 3, 6, 12)),
  ADD CONSTRAINT inspection_schedule_anchor_check
    CHECK (anchor_month BETWEEN 1 AND 12);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. La ocurrencia: cuánto dura ESTE período.
--
-- `period_months` se COPIA de la regla al abrir, igual que `template_id` e
-- `inspector_id`, y por el mismo motivo que 0008 escribió al lado de aquéllas: «la regla
-- es una fábrica, no un padre». Desactivar la regla, o crear otra con otra frecuencia, no
-- puede reescribir la forma de un período que ya se abrió y que quizás ya se inspeccionó.
--
-- Sin esta columna la longitud habría que leerla por join a la regla, y entonces el largo
-- de un período de 2026 dependería de una fila que se puede desactivar en 2027.
ALTER TABLE scheduled_inspection
  ADD COLUMN period_months smallint NOT NULL DEFAULT 1;

--> statement-breakpoint

-- Mismo criterio que el ancla: el default existe para el backfill —todo lo abierto hasta
-- hoy es mensual— y se retira para que la fila nueva tenga que decir su largo. El trabajo
-- de apertura y la programación manual lo dicen los dos.
ALTER TABLE scheduled_inspection
  ALTER COLUMN period_months DROP DEFAULT;

--> statement-breakpoint

ALTER TABLE scheduled_inspection
  ADD CONSTRAINT scheduled_inspection_period_months_check
    CHECK (period_months IN (1, 3, 6, 12));

--> statement-breakpoint

-- LA COLUMNA GENERADA SE REEMPLAZA, no se altera: Postgres no deja cambiar la expresión
-- de una GENERATED ALWAYS ... STORED. Hay que tirarla y volver a crearla.
--
-- Al tirarla CAE `scheduled_inspection_pending_idx`, que la indexa. Se recrea abajo,
-- idéntico. Es la única dependencia: `period_end` no participa de ninguna FK, de ninguna
-- vista, ni del único parcial de idempotencia —que es sobre `period_start`—. Sí la lee
-- `hs_scheduled_inspection_audit()`, pero plpgsql resuelve `NEW.period_end` en tiempo de
-- ejecución y la columna vuelve a existir antes de que ese trigger corra de nuevo.
ALTER TABLE scheduled_inspection DROP COLUMN period_end;

--> statement-breakpoint

-- El fin del período, ahora en función del largo. Sigue siendo generada y no almacenada
-- aparte por lo que 0008 explicó y que no cambió: guardar el fin como columna
-- independiente abriría la puerta a una fila con inicio y fin inconsistentes, que es un
-- estado que ningún código produce a propósito y que igual aparece. Febrero de un año
-- bisiesto no puede estar mal porque nadie lo calcula dos veces.
ALTER TABLE scheduled_inspection
  ADD COLUMN period_end date GENERATED ALWAYS AS
    ((period_start + (period_months * INTERVAL '1 month') - INTERVAL '1 day')::date) STORED;

--> statement-breakpoint

-- La pantalla de inicio del miembro del JHSC: lo mío, no cancelado, por vencimiento.
-- Idéntico al de 0008; se recrea porque el DROP COLUMN se lo llevó.
CREATE INDEX scheduled_inspection_pending_idx
  ON scheduled_inspection (inspector_id, period_end)
  WHERE cancelled_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. La guarda: las tres columnas nuevas son inmutables.
--
-- POR QUÉ LA FRECUENCIA NO SE PUEDE CAMBIAR, que es la parte que sorprende:
--
-- El CTE `owed` del reporte de cumplimiento no cuenta las inspecciones que existen —eso
-- es justamente el error que ese archivo existe para no cometer—: GENERA los períodos que
-- el sitio DEBÍA, a partir de la regla. Entonces cambiarle la frecuencia a una regla viva
-- no cambia el futuro, reescribe el pasado: un año que se reportó como «12 de 12» pasa a
-- leerse «4 de 12» porque la regla que lo generaba ahora dice otra cosa.
--
-- Cambiar la frecuencia es desactivar la regla y crear otra. Es el mismo idioma que ya
-- tienen `site_id` y `template_id` en esta tabla, y deja las dos ventanas
-- `created_at`..`deactivated_at` contiguas, que es exactamente lo que el reporte necesita
-- para decir la verdad sobre los dos tramos.
--
-- Se reemplaza la función entera de 0008 §5. Los tres triggers apuntan a ella por nombre
-- y no hay que recrearlos.
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
      ARRAY['id', 'site_id', 'template_id', 'created_at', 'created_by',
            'frequency_months', 'anchor_month']
    WHEN 'scheduled_inspection' THEN
      ARRAY['id', 'site_id', 'period_start', 'period_months', 'template_id',
            'template_version_id', 'scheduled_at', 'scheduled_by']
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

-- ---------------------------------------------------------------------------
-- 4. Los privilegios: nada que agregar, y eso es el requisito.
--
-- 0008 §8 concede `GRANT SELECT, INSERT` a nivel de TABLA sobre las dos, así que las
-- columnas nuevas ya se pueden insertar sin tocar nada. Y la lista de lo mutable —
-- `GRANT UPDATE (default_inspector_id, deactivated_at)` y
-- `GRANT UPDATE (inspector_id, cancelled_at, cancellation_reason)`— NO se extiende: la
-- frecuencia, el ancla y el largo del período quedan fuera a propósito.
--
-- Es la primera barrera (42501 para hs_app); el §3 de acá arriba es la segunda (HS001
-- para cualquier rol, el dueño incluido). Sin las dos, "parcialmente mutable" quiere
-- decir, en la práctica, "entera".

-- ---------------------------------------------------------------------------
-- 5. La auditoría del alta de una regla dice con qué frecuencia nació.
--
-- Sin esto, la entrada `inspection_schedule.created` de una regla trimestral se lee
-- idéntica a la de una mensual, y la cadena de auditoría no permitiría reconstruir por
-- qué el sitio debía cuatro períodos y no doce.
--
-- No hace falta un evento de cambio: las dos columnas son inmutables por el §3.
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
      body || jsonb_build_object(
        'default_inspector_id', NEW.default_inspector_id,
        'frequency_months', NEW.frequency_months,
        'anchor_month', NEW.anchor_month));

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
