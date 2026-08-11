import { WINDOW_MONTHS_DEFAULT } from '@hs/contracts';
import type { PoolClient } from 'pg';

/**
 * Requisitos §5 riesgo A y §7 etapa 7 — LA MARCA DE RECURRENCIA, escrita al nacer.
 *
 * Vive en `findings` y no en `reporting` a propósito (design D10): esto es parte de la
 * transacción de ingesta, no del reporte. `reporting` calcula series al leer y no llama
 * a nadie; esta función la llama la ingesta junto con la derivación, con el mismo
 * cliente y antes del commit.
 *
 * LO QUE ESTA FUNCIÓN NO ES: no es la consulta de recurrencia. Esa agrupa hallazgos en
 * series con la ventana que el lector pidió, y vive en `reporting/recurrence.sql.ts`.
 * Esta contesta una pregunta distinta y más chica —«¿cuántas veces había pasado esto
 * cuando este hallazgo nació?»— y su respuesta se congela.
 */

export { WINDOW_MONTHS_DEFAULT };

/**
 * Escribe una marca por cada hallazgo derivado de la inspección recién insertada.
 *
 * UN SOLO `INSERT ... SELECT` PARA TODO EL ENVÍO (design D7). Una inspección con ocho
 * respuestas negativas produce ocho hallazgos, y ocho viajes a la base dentro de una
 * transacción abierta por un teléfono con señal intermitente es exactamente la latencia
 * que ADR-001 evita. El agregado se hace en un `LEFT JOIN LATERAL` por hallazgo, sobre
 * el índice parcial `finding_recurrence_idx` que 0010 dejó creado para esto.
 *
 * LAS CUATRO REGLAS DEL CONTEO, cada una con su línea en el SQL:
 *
 *   1. **Solo hallazgos derivados.** `f.item_key IS NOT NULL` filtra los manuales, que
 *      no tienen concepto estable y por lo tanto no tienen serie (§5 riesgo A).
 *
 *   2. **Los del mismo envío no se cuentan entre sí.** `p.inspection_id <>
 *      f.inspection_id`: dos guardas faltantes encontradas en la misma caminata son un
 *      hallazgo cada una, no una recurrencia de la otra. Sin esta línea, un envío con
 *      dos hallazgos del mismo ítem en la misma ubicación marcaría al segundo como
 *      recurrente por existir el primero, que es una recurrencia de cero meses.
 *
 *   3. **«Previo» es por `occurred_at`, con desempate por `recorded_at`.** Dos hallazgos
 *      del mismo instante no pueden contarse mutuamente como previos, que es lo que
 *      pasaría con un `<=`.
 *
 *   4. **La ventana se mide sobre `occurred_at`**, el reloj del dispositivo al firmar
 *      (§5 riesgo C). Una inspección caminada en octubre y sincronizada en noviembre
 *      cuenta en octubre, acá igual que en el reporte de cumplimiento.
 *
 * SIN `WHERE site_id` EN NINGUNA PARTE (ADR-002). El conteo mira solo el sitio de la
 * sesión porque la política no le muestra otra cosa — ni los hallazgos de la otra planta
 * al contar, ni las marcas de la otra planta al insertar. Que el `site_id` de la marca
 * sea el de su hallazgo lo garantiza la FK compuesta, no este código.
 *
 * `is_recurrent` no aparece en la lista de columnas y esa ausencia es el requisito: la
 * calcula el motor a partir de `prior_count` (design D5).
 */
export async function insertRecurrenceMarks(
  client: PoolClient,
  inspectionId: string,
  windowMonths: number = WINDOW_MONTHS_DEFAULT,
): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO finding_recurrence (finding_id, site_id, item_key, location_id,
                                     window_months, prior_count, prior_count_site_wide,
                                     first_prior_occurred_at)
     SELECT f.id, f.site_id, f.item_key, f.location_id,
            $2,
            prior.same_location,
            prior.site_wide,
            prior.first_same_location
       FROM finding f
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE p.location_id = f.location_id)     AS same_location,
           count(*)                                                  AS site_wide,
           min(p.occurred_at) FILTER (WHERE p.location_id = f.location_id)
                                                                     AS first_same_location
           FROM finding p
          WHERE p.item_key = f.item_key
            AND p.inspection_id IS DISTINCT FROM f.inspection_id
            AND (p.occurred_at, p.recorded_at) < (f.occurred_at, f.recorded_at)
            AND p.occurred_at >= f.occurred_at - make_interval(months => $2::int)
       ) prior ON true
      WHERE f.inspection_id = $1
        AND f.item_key IS NOT NULL`,
    [inspectionId, windowMonths],
  );

  return rowCount ?? 0;
}
