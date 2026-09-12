-- La obligación mensual de cada planta: una regla por sitio contra la plantilla de
-- inspección general mensual de `001_monthly_general_inspection.sql`.
--
-- POR QUÉ EXISTE. Sin una regla, el trabajo `inspections.open-period` corre todos los
-- días, no encuentra nada que abrir y no produce nada — en silencio, que es la peor
-- forma de no funcionar. Un entorno recién levantado tiene que tener algo que abrir.
--
-- SIN INSPECTOR POR DEFECTO, y no es un olvido. El usuario que siembra
-- `004_bootstrap_coordinator.sql` es el coordinador de HS, pero esta regla no debe
-- inventar una asignación durante el bootstrap. El coordinador asigna cuando existan las
-- cuentas y confirme quién tiene el alcance vigente para ejecutar la inspección.
--
-- Consecuencia: las inspecciones que abra el calendario nacen con `inspector_id` NULL
-- y no aparecen en el pendiente de nadie hasta que se asignen. Eso es correcto — la
-- obligación existe aunque todavía no tenga dueño, y la notificación al coordinador es
-- justamente el aviso de que hay que asignarla.
--
-- IDEMPOTENTE. `pnpm db:seed` se corre las veces que haga falta.

-- El alcance de sitio, ANTES de cualquier INSERT: `inspection_schedule` lleva
-- `hs_apply_site_isolation`, que hace FORCE ROW LEVEL SECURITY y por lo tanto alcanza
-- también a hs_migrator, que es el rol con el que corren los seeds. Sin esta línea el
-- WITH CHECK de la política rechaza el INSERT con un error que no menciona RLS.
--
-- Hace falta además por una segunda razón: el trigger `inspection_schedule_audit`
-- escribe en la cadena de la planta, y `audit_log` lleva la misma política.
SELECT set_config(
  'app.site_ids',
  '5717e900-0000-4000-8000-000000000001,5717e900-0000-4000-8000-000000000002',
  true);

-- El actor de la cadena de auditoría: el coordinador sembrado por 004. Sin esto, las
-- entradas quedarían con actor nulo, que es lo que corresponde a un trabajo automático
-- y no a una decisión de configuración.
SELECT set_config('app.user_id', 'acc00000-0000-4000-8000-000000000001', true);

-- `WHERE NOT EXISTS` y no `ON CONFLICT DO NOTHING`: el único es un índice PARCIAL
-- (`WHERE deactivated_at IS NULL`) y `ON CONFLICT` sobre un parcial exige repetir su
-- predicado como inferencia, que es más frágil de leer que la condición explícita.
--
-- MENSUAL Y ANCLADA EN ENERO, explícito desde 0029. Para una regla mensual el ancla no
-- significa nada —`mod 1` es cero para todos los meses— así que enero acá no es una
-- elección, es el único valor que no puede distinguirse de otro.
INSERT INTO inspection_schedule
  (site_id, template_id, frequency_months, anchor_month, default_inspector_id, created_by)
SELECT s.id,
       t.id,
       1,
       1,
       NULL,
       'acc00000-0000-4000-8000-000000000001'
  FROM site s
 CROSS JOIN template t
 WHERE s.code IN ('st-thomas', 'glencoe')
   AND t.key = 'monthly-general-inspection'
   AND NOT EXISTS (
     SELECT 1 FROM inspection_schedule existing
      WHERE existing.site_id = s.id
        AND existing.template_id = t.id
        AND existing.deactivated_at IS NULL
   );
