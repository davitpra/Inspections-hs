-- Requisitos §7 — Retirar una plantilla publicada desde la consola de plantillas.
--
-- `0003` §9 revocó TODO el UPDATE sobre `template` a hs_app con el argumento de que
-- publicar es insertar una versión nueva, y eso sigue siendo cierto: acá no se concede
-- nada que tenga que ver con el contenido. Lo que se concede es la BAJA LÓGICA de la
-- cabecera, que `0003` ya había previsto al crear `deactivated_at` y que hasta hoy solo
-- podía escribir hs_migrator.
--
-- Retirar una plantilla es una decisión de catálogo, no de programación: deja de
-- ofrecerse al crear una regla o al programar fuera de calendario —`GET /templates` ya
-- filtra por esta columna— y NO frena las reglas de recurrencia que ya la nombran. Para
-- eso está la baja de la propia regla (`0032`). Por eso el planificador no cambia.
--
-- SIN política RLS, igual que el resto del módulo: `template` no lleva `site_id` porque
-- una plantilla es contenido de referencia de la organización y no un dato de planta
-- (`0003` §1). La misma fila la ven todas las plantas, y retirarla las alcanza a todas.
--
-- SIN trigger de auditoría, al revés que `0026` con `site`, y no es un olvido:
-- `audit_log` es una cadena POR PLANTA —lleva `site_id` y su hash encadena dentro de esa
-- planta— y una plantilla no pertenece a ninguna. Anotar la baja en una planta elegida al
-- azar, o en todas, escribiría un hecho que no ocurrió ahí.
--
-- DELETE y TRUNCATE siguen prohibidos para todos los roles por `template_forbid_deletion`
-- y `template_forbid_truncate` de `0003` §7. Nunca DELETE: una plantilla retirada sigue
-- siendo la referencia de las inspecciones que se hicieron con ella.

REVOKE UPDATE ON template FROM hs_app;

--> statement-breakpoint

-- Solo la baja lógica. `name` queda afuera a propósito: renombrar una plantilla publicada
-- cambiaría, sin publicar nada, cómo se nombra un documento ya congelado.
GRANT UPDATE (deactivated_at) ON template TO hs_app;

--> statement-breakpoint

-- La guarda de mutabilidad parcial que `template_item` tiene desde `0003` §7 y que
-- `template` no tenía porque no admitía ningún UPDATE. Ahora que admite uno, la necesita:
-- el GRANT por columna protege a hs_app, pero hs_migrator entra por arriba de los
-- privilegios y es justamente quien corre los seeds.
CREATE OR REPLACE FUNCTION hs_template_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'template identity is immutable: updating "%" is not allowed',
      OLD.key
      USING ERRCODE = 'HS001',
            HINT = 'key and id are assigned once; deactivate the template instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER template_guard
  BEFORE UPDATE ON template
  FOR EACH ROW EXECUTE FUNCTION hs_template_guard();
