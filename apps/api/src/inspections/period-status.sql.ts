import { SITE_TIME_ZONE } from '../jobs/job-registry';

/**
 * Los cuatro estados de un período, escritos UNA vez.
 *
 * §4 exige el estado «for every non-cancelled `scheduled_inspection`», y hasta este
 * change la única implementación vivía dentro de `COMPLIANCE_PERIODS_SQL`, que pide un
 * sitio explícito y un rango de meses enteros. Es decir: el requisito estaba escrito y
 * cumplido a medias, y cualquier listado que quisiera el estado tenía que volver a
 * derivarlo.
 *
 * DOS COPIAS DE ESTO SERÍA EL PEOR LUGAR PARA TENER DOS COPIAS. La rama `open` lleva
 * adentro la frontera del día civil en Ontario, que es exactamente la clase de regla que
 * se escribe distinto la segunda vez —un `>` en vez de un `>=`, UTC en vez de Toronto— y
 * que nadie nota hasta que un mes cerrado aparece abierto en una pantalla y omitido en un
 * documento regulatorio. La que envejecería es la del listado; la que lleva digest es la
 * otra.
 *
 * EL ORDEN DE LAS RAMAS ES EL REQUISITO, no una optimización:
 *
 *   1. `cancelled` gana sobre todo. Una inspección cancelada no es ni cumplida ni
 *      omitida, y su motivo viaja al lado.
 *   2. `completed` mira si EXISTE la inspección, y nada más. No mira `received_at`: §5
 *      riesgo C fijó el reloj del dispositivo al firmar como el reloj del cumplimiento,
 *      así que caminar el 28 y sincronizar el 4 del mes siguiente cumple ese período.
 *   3. `open` es el período que todavía no cerró en Ontario. **No cuenta como omitido**:
 *      contar como incumplido un mes que no terminó es fabricar un incumplimiento.
 *   4. `missed` es el resto.
 *
 * Se parametriza por alias y por expresiones —y no se escribe con alias fijos— porque los
 * dos consumidores llegan a las mismas filas por caminos distintos: el reporte pasa por
 * un `LATERAL` sobre los períodos que el sitio DEBÍA (incluidos los que nunca se
 * abrieron), y el listado va directo sobre las filas que existen.
 */
export interface PeriodStatusColumns {
  /** Alias de `scheduled_inspection`. */
  scheduled: string;
  /** Alias del `LEFT JOIN inspection`. */
  inspection: string;
  /** Expresión de la fecha de fin del período. */
  periodEnd: string;
  /**
   * Expresión `timestamptz` del reloj. El default es el del servidor; el reporte pasa
   * un placeholder para poder fijarlo en los tests sin tocar el reloj del contenedor.
   */
  clock?: string;
}

export function periodStatusCase({
  scheduled,
  inspection,
  periodEnd,
  clock = 'now()',
}: PeriodStatusColumns): string {
  return `CASE
           WHEN ${scheduled}.cancelled_at IS NOT NULL THEN 'cancelled'
           WHEN ${inspection}.id IS NOT NULL          THEN 'completed'
           WHEN ${periodEnd} >= ((${clock}) AT TIME ZONE '${SITE_TIME_ZONE}')::date
             THEN 'open'
           ELSE 'missed'
         END`;
}
