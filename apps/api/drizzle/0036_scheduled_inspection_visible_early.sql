-- 0036 — Visibilidad temprana de un período abierto a mano.
--
-- POR QUÉ. La consola de planificación anual puede abrir cualquier período del año por
-- adelantado (`schedule()`, la vía "fuera del calendario" de `0008`), a diferencia del
-- cron de ADR-005 que solo abre el período que ya contiene al mes corriente. Sin un dato
-- propio, un período abierto en agosto para diciembre aparecía de inmediato en la lista
-- del inspector como listo para descargar — el mismo criterio de "¿ya llegó el mes?" que
-- decide el cron no existía del lado de la lectura.
--
-- LA COLUMNA ES INMUTABLE, como `required` de `0003` o `is_root` de `0012`: se decide al
-- abrir el período y no cambia después. Por eso no lleva `GRANT UPDATE` ni entra en el
-- arreglo `frozen` de `hs_scheduling_guard()` — sin privilegio de UPDATE ya está protegida,
-- y agregarla al guard sería proteger dos veces lo mismo. El `GRANT INSERT` de tabla
-- completa que ya existe desde `0008` alcanza para escribirla al crear la fila.
--
-- El cron (`openPeriod()`) nunca la nombra en su INSERT: solo abre lo que ya empezó, así
-- que el default `false` es siempre el valor correcto ahí y no hace falta tocar esa
-- consulta.

ALTER TABLE scheduled_inspection ADD COLUMN visible_early boolean NOT NULL DEFAULT false;

--> statement-breakpoint

-- La función se reescribe entera porque `CREATE OR REPLACE` no compone: las ramas de
-- `0030` siguen tal cual, y el INSERT gana el dato nuevo en su cuerpo. No hace falta una
-- rama de UPDATE — la columna nunca cambia, así que no hay un segundo hecho que auditar.
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
        'scheduled_by', NEW.scheduled_by,
        'visible_early', NEW.visible_early));

    RETURN NULL;
  END IF;

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

  IF NEW.template_version_id IS DISTINCT FROM OLD.template_version_id THEN
    PERFORM hs_identity_audit_entry(
      NEW.site_id, 'inspection.version_advanced',
      body || jsonb_build_object(
        'previous_template_version_id', OLD.template_version_id));
  END IF;

  RETURN NULL;
END;
$fn$;
