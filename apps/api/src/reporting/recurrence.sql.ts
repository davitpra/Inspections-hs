/**
 * Requisitos §5 riesgo A, §6-bis pregunta 11 y §7 etapa 7 — LA CONSULTA DE RECURRENCIA.
 *
 * Esta es la consulta por la que ADR-004 eligió Drizzle en lugar de Prisma: SQL crudo,
 * con agregados condicionales, `DISTINCT ON` y un `GROUP BY` que conmuta por parámetro.
 * El comentario de ADR-004 dice, textualmente, «SQL crudo para la consulta de recurrencia
 * por `item_key`». Es esto.
 *
 * EL MODO DE FALLO QUE HAY QUE TENER PRESENTE AL LEER ESTO, porque es el riesgo más
 * peligroso del proyecto (§5 riesgo A): **una agrupación mal hecha no produce ningún
 * error**. Los IDs existen, los joins funcionan, la consulta devuelve filas y la pantalla
 * renderiza — simplemente agrupa mal, y "agrupa mal" en una detección de patrones se ve
 * idéntico a "no hay patrón". El sistema mostraría una pantalla que dice que no hay
 * hallazgos recurrentes y nadie dudaría de ella.
 *
 * De ahí las dos reglas que este archivo no puede violar:
 *
 *   1. **Se agrupa por `item_key`, NUNCA por `template_version_item_id`.** La primera es
 *      el concepto estable; la segunda es la fila publicada, que cambia con cada edición
 *      de la plantilla. Agrupar por la segunda parte toda serie que cruce una versión.
 *
 *   2. **`template_version_item_count` viaja en cada serie.** Es el número con el que un
 *      lector puede notar que la agrupación cruzó lo que tenía que cruzar. Si todas las
 *      series de un sitio con años de ediciones dijeran `1`, la regla 1 estaría rota.
 *
 * SIN `WHERE site_id` EN NINGUNA PARTE (ADR-002). El recorte lo hace la política sobre la
 * transacción. `site_id` sí está en el `GROUP BY`, que es otra cosa: es lo que impide que
 * un lector con alcance a las dos plantas reciba una serie que mezcla las dos.
 */

/**
 * Las series, con el `GROUP BY` conmutado por `$2` (design D4).
 *
 * UNA SOLA CONSULTA PARA LOS DOS MODOS, y no dos. La ventana, la exclusión de los
 * manuales, el umbral de dos y el orden son idénticos en ambos; escribirlos dos veces es
 * garantizar que un día uno de los dos tenga el criterio viejo. El `CASE` colapsa a NULL
 * en modo `item`, que es exactamente lo que el contrato pide devolver en `location_id`.
 *
 * El modo llega desde un `z.enum` y nunca desde la cadena cruda del query string: los
 * únicos dos valores que alcanzan `$2` son literales validados.
 *
 * `HAVING count(*) >= 2` es el umbral: una sola ocurrencia no es un patrón, y devolverla
 * convertiría esta vista en el listado de hallazgos que ya existe.
 *
 * El prompt sale de un `DISTINCT ON` sobre las versiones en que se contestó el ítem,
 * ordenado por versión descendente (design D9): una serie que cruza tres redacciones
 * muestra la más reciente. La histórica de cada hallazgo sigue siendo resoluble por su
 * `template_version_item_id`, que es para lo que existe la identidad dual.
 */
export const RECURRENCE_SERIES_SQL = `
  WITH windowed AS (
    SELECT f.id, f.site_id, f.item_key, f.location_id, f.template_version_item_id,
           f.occurred_at
      FROM finding f
     WHERE f.item_key IS NOT NULL
       AND f.occurred_at >= now() - make_interval(months => $1::int)
  )
  SELECT w.site_id,
         w.item_key,
         CASE WHEN $2::text = 'item_location' THEN w.location_id END AS location_id,
         count(DISTINCT w.location_id)::int                          AS location_count,
         count(*)::int                                               AS occurrence_count,
         count(DISTINCT w.template_version_item_id)::int             AS template_version_item_count,
         min(w.occurred_at)                                          AS first_occurred_at,
         max(w.occurred_at)                                          AS last_occurred_at,
         array_agg(w.id ORDER BY w.occurred_at DESC, w.id)           AS finding_ids,
         prompt.prompt                                               AS item_prompt
    FROM windowed w
    LEFT JOIN LATERAL (
      SELECT tvi.prompt
        FROM template_version_item tvi
        JOIN template_version tv ON tv.id = tvi.template_version_id
       WHERE tvi.item_key = w.item_key
       ORDER BY tv.version DESC
       LIMIT 1
    ) prompt ON true
   GROUP BY w.site_id,
            w.item_key,
            CASE WHEN $2::text = 'item_location' THEN w.location_id END,
            prompt.prompt
  HAVING count(*) >= 2
   ORDER BY occurrence_count DESC, last_occurred_at DESC, w.item_key`;

/**
 * Los hallazgos de la ventana que no entran a ninguna serie porque no tienen concepto
 * estable: los manuales (design D8).
 *
 * **Este número viaja siempre, también cuando es cero.** Sin él, una lista de series
 * vacía se lee como "no hay patrones" cuando puede significar "no hay datos con los que
 * buscarlos" — y §5 riesgo A es precisamente sobre no poder distinguir esas dos cosas.
 *
 * Corre en la misma transacción y bajo la misma política que la consulta de arriba, así
 * que cuenta los mismos sitios que las series omiten.
 */
export const EXCLUDED_MANUAL_SQL = `
  SELECT count(*)::int AS excluded_manual_count
    FROM finding f
   WHERE f.item_key IS NULL
     AND f.occurred_at >= now() - make_interval(months => $1::int)`;
