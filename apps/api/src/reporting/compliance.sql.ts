/**
 * Requisitos §3 R5 y §1 — LA CONSULTA DE COBERTURA POR PERÍODO.
 *
 * De acá sale la métrica número uno del proyecto: «cobertura de períodos, 24 de 24». Es
 * la consulta que dice, mes por mes y planta por planta, si la inspección se hizo, no se
 * hizo, se canceló o todavía se puede hacer.
 *
 * LOS DOS ERRORES QUE ESTA CONSULTA EXISTE PARA NO COMETER, y los dos son silenciosos:
 *
 *   1. **Partir de `scheduled_inspection`.** Sería lo natural —una fila por período— y
 *      haría desaparecer del reporte cualquier mes en el que el trabajo de apertura no
 *      corrió. `required_count` bajaría a 11 y el documento diría «11 de 11» sobre un año
 *      al que le faltó un mes. Por eso los períodos que un sitio DEBE salen de
 *      `inspection_schedule` —la regla, que es la que sabe que abril existía— y las filas
 *      de `scheduled_inspection` se le suman por `UNION`, nunca al revés (design D6).
 *
 *   2. **Contar el mes corriente como omitido.** Un período que todavía no cerró no es un
 *      período que alguien se salteó. Sería fabricar un incumplimiento en el documento
 *      que se le entrega al MLITSD, todos los meses, hasta que el mes termine.
 *
 * EL CALENDARIO ES `America/Toronto` Y NO UTC (design D7). El trabajo de apertura de 0008
 * resuelve el período corriente en ese calendario; si el borde `open`/`missed` se midiera
 * en UTC, habría cinco horas por mes en las que el reporte declararía un incumplimiento
 * que el planificador no reconoce. Abrir y cumplir tienen que hablar del mismo mes.
 *
 * EL `WHERE site_id` DE ESTA CONSULTA NO ES EL AISLAMIENTO, y conviene que quede escrito
 * porque contradice a primera vista el invariante del proyecto. El aislamiento lo aplica
 * la política RLS sobre la transacción, como en todo el sistema: sin alcance declarado,
 * `inspection_schedule` y `scheduled_inspection` no devuelven una sola fila y el reporte
 * sale vacío. Lo que el parámetro hace es SELECCIONAR una planta entre las que la sesión
 * ya puede ver, porque R5 pide el reporte «por sitio» y un coordinador con las dos
 * plantas en su alcance necesita poder pedir una. Quitar el parámetro no agregaría
 * seguridad; agregaría una mezcla de dos plantas en un documento regulatorio.
 */

/**
 * Los períodos del rango con su estado.
 *
 * Parámetros: `$1` sitio, `$2` inicio del rango (día 1 de un mes), `$3` fin del rango
 * (último día de un mes), `$4` el reloj — `NULL` significa «ahora».
 *
 * **`$4` NO ES UN ADORNO DE TEST.** Es el mismo recurso que usan los trabajos de 0008 y
 * de la etapa 5 (`now` en el payload): permite fijar el instante desde afuera. Acá se
 * cobra en el borde que importa —el 31 de agosto a las 21:00 de Ontario son las 01:00 UTC
 * del 1 de septiembre— y probarlo sin él exigiría mover el reloj del proceso.
 */
export const COMPLIANCE_PERIODS_SQL = `
  WITH months AS (
    SELECT gs::date                                              AS period_start,
           (gs + INTERVAL '1 month' - INTERVAL '1 day')::date    AS period_end
      FROM generate_series($2::date, $3::date, INTERVAL '1 month') gs
  ),
  -- LO QUE EL SITIO DEBÍA. Las dos mitades del UNION dicen cosas distintas y hacen falta
  -- las dos:
  --
  --   a) la regla estaba activa ese mes → el sitio lo debía, HAYA O NO fila de
  --      planificación. Es la mitad que hace visible el mes que el trabajo no abrió.
  --   b) existe una scheduled_inspection de ese mes → se planificó, así que se debía,
  --      aunque hoy la regla esté desactivada o la haya programado el coordinador a mano.
  --      Es lo que hace que desactivar una regla no borre del reporte lo que ya abrió.
  --
  -- Una regla creada a mitad de mayo hace deber mayo: el trabajo de apertura habría
  -- abierto ese mismo período al día siguiente. Una desactivada en septiembre deja de
  -- hacer deber octubre, y septiembre sigue debiéndose.
  owed AS (
    SELECT m.period_start, m.period_end, sch.site_id, sch.template_id
      FROM months m
      JOIN inspection_schedule sch
        ON sch.site_id = $1::uuid
       AND sch.created_at < (m.period_start + INTERVAL '1 month')
       AND (sch.deactivated_at IS NULL OR sch.deactivated_at >= m.period_start)
    UNION
    SELECT m.period_start, m.period_end, si.site_id, si.template_id
      FROM months m
      JOIN scheduled_inspection si
        ON si.site_id = $1::uuid
       AND si.period_start = m.period_start
  )
  SELECT o.period_start,
         o.period_end,
         si.id                                                   AS scheduled_inspection_id,
         o.template_id,
         si.template_version_id,
         i.id                                                    AS inspection_id,
         i.submitted_by,
         -- EL RELOJ DEL DISPOSITIVO AL FIRMAR, no el del servidor al recibir (§5 riesgo
         -- C). El contrato lo llama occurred_at porque es el mismo concepto que en
         -- finding; en la tabla inspection la columna se llama signed_at.
         i.signed_at                                             AS occurred_at,
         si.cancellation_reason,
         CASE
           -- El orden de las ramas es el requisito. Cancelado gana sobre todo: una
           -- inspección cancelada no es ni cumplida ni omitida, y su motivo viaja al lado.
           WHEN si.cancelled_at IS NOT NULL THEN 'cancelled'
           WHEN i.id IS NOT NULL            THEN 'completed'
           -- El período todavía no cerró en Ontario. NO cuenta como omitido.
           WHEN o.period_end >= (COALESCE($4::timestamptz, now()) AT TIME ZONE 'America/Toronto')::date
             THEN 'open'
           ELSE 'missed'
         END                                                     AS status
    FROM owed o
    -- LATERAL con LIMIT 1 y no un JOIN a secas: 0008 permite volver a programar un
    -- período cuya inspección se canceló, así que un mes puede tener DOS filas. Se
    -- prefiere la viva; si no hay viva, la cancelada es lo que pasó ese mes.
    LEFT JOIN LATERAL (
      SELECT s.*
        FROM scheduled_inspection s
       WHERE s.site_id = o.site_id
         AND s.template_id = o.template_id
         AND s.period_start = o.period_start
       ORDER BY (s.cancelled_at IS NULL) DESC, s.scheduled_at DESC
       LIMIT 1
    ) si ON true
    LEFT JOIN inspection i ON i.scheduled_inspection_id = si.id
   ORDER BY o.period_start, o.template_id`;

/**
 * Los hallazgos del rango, con su clasificación VIGENTE al momento de generar.
 *
 * Se congelan dentro del payload y no se resuelven al leer: un reporte de julio tiene que
 * seguir mostrando lo que el hallazgo decía en julio. La clasificación vigente sale del
 * mismo `LEFT JOIN LATERAL` sobre la fila que nadie supera que usa `FINDING_SELECT`, y es
 * `LEFT` por el mismo motivo: un hallazgo sin clasificar aparece, y aparece como lo que
 * es.
 *
 * El rango se mide sobre `occurred_at` convertido al calendario de Ontario, igual que el
 * borde de los períodos: un hallazgo del 31 de agosto a las 21:00 pertenece a agosto en
 * las dos consultas o el documento se contradice a sí mismo.
 */
export const COMPLIANCE_FINDINGS_SQL = `
  SELECT f.id,
         f.occurred_at,
         f.location_id,
         f.item_key,
         f.description,
         a.risk_level
    FROM finding f
    LEFT JOIN LATERAL (
      SELECT r.risk_level
        FROM finding_risk_assessment r
       WHERE r.finding_id = f.id
         AND NOT EXISTS (
           SELECT 1 FROM finding_risk_assessment s WHERE s.supersedes_id = r.id)
    ) a ON true
   WHERE f.site_id = $1::uuid
     AND (f.occurred_at AT TIME ZONE 'America/Toronto')::date BETWEEN $2::date AND $3::date
   ORDER BY f.occurred_at DESC, f.id`;

/**
 * Cuántos hallazgos del rango quedaron fuera de toda serie por no tener concepto estable.
 *
 * Es el mismo número que el reporte de recurrencia lleva y por el mismo motivo: sin él,
 * cero series se lee como «nada se repitió» cuando puede significar «no había con qué
 * buscarlo». En un documento regulatorio esa diferencia es la que separa «revisamos y no
 * hay patrón» de «no miramos».
 */
export const COMPLIANCE_EXCLUDED_MANUAL_SQL = `
  SELECT count(*)::int AS excluded_manual_count
    FROM finding f
   WHERE f.site_id = $1::uuid
     AND f.item_key IS NULL
     AND (f.occurred_at AT TIME ZONE 'America/Toronto')::date BETWEEN $2::date AND $3::date`;

/**
 * Las acciones correctivas todavía abiertas, con las vencidas marcadas.
 *
 * `state` sale del último evento —no de una columna, que no existe (ADR-002)— y `overdue`
 * de comparar `due_at` con el reloj. Los dos son derivados y por eso se congelan acá: un
 * reporte que los recalculara al leer se contradiría con su propio hash.
 *
 * Parámetros: `$1` sitio, `$2` el reloj (`NULL` es «ahora»). NO lleva el rango, y no es
 * un olvido: lo que el documento tiene que mostrar es lo que sigue abierto AL MOMENTO DE
 * GENERAR, no lo que se abrió dentro del rango. Una acción de noviembre todavía sin
 * cerrar es parte del estado del sitio aunque el reporte cubra enero a marzo.
 *
 * `closed` queda fuera: lo que el documento tiene que mostrar es lo que sigue pendiente.
 * Las cerradas dentro del rango son parte de otra conversación —la de cumplimiento de
 * plazos— que R5 no pide y que no se inventa acá.
 */
export const COMPLIANCE_OPEN_ACTIONS_SQL = `
  SELECT a.id,
         a.finding_id,
         a.description,
         a.severity,
         a.due_at,
         s.to_state                                              AS state,
         (a.due_at < COALESCE($2::timestamptz, now()))           AS overdue
    FROM corrective_action a
    LEFT JOIN LATERAL (
      SELECT e.to_state
        FROM corrective_action_event e
       WHERE e.action_id = a.id
       ORDER BY e.position DESC
       LIMIT 1
    ) s ON true
   WHERE a.site_id = $1::uuid
     AND s.to_state <> 'closed'
   ORDER BY a.due_at, a.id`;
