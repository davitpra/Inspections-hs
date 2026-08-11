import { Injectable } from '@nestjs/common';
import type { RecurrenceQuery, RecurrenceReport, RecurrenceSeries } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { EXCLUDED_MANUAL_SQL, RECURRENCE_SERIES_SQL } from './recurrence.sql';

/**
 * Requisitos §7 etapa 7 — Lo que se puede preguntar sobre la recurrencia desde HTTP.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor:
 *
 *   - Que una planta no vea la otra              → política RLS. No hay `WHERE site_id`
 *     en ninguna consulta de este archivo ni de `recurrence.sql.ts`.
 *   - Que el auditor externo no vea fuera de su ventana de registros → política de
 *     ventana, activada por `withSessionClient`.
 *
 * QUÉ NO HACE, y es deliberado:
 *
 *   - **No lee `finding_recurrence`.** Las series se construyen desde `finding` con la
 *     ventana que el lector pidió. Leer `prior_count` para armarlas dejaría un reporte a
 *     24 meses limitado por marcas calculadas a 12 (design D2). La marca y la serie
 *     contestan preguntas distintas y este servicio contesta la segunda.
 *
 *   - **No llama a `FindingsService`.** Es una consulta de agregación sobre tablas, no
 *     una composición de servicios: traer hallazgos completos con fotos y clasificación
 *     vigente para después contarlos en Node sería contar en el lugar equivocado
 *     (design D10).
 *
 *   - **No comprueba roles.** Todo rol con alcance lee su recurrencia; qué sitios entran
 *     lo decide la sesión y lo aplica la política. Una comprobación acá sería una segunda
 *     respuesta a una pregunta que ya está contestada.
 */
@Injectable()
export class ReportingService {
  constructor(private readonly db: DbService) {}

  /**
   * Las series de la ventana, más el número de hallazgos que quedaron fuera de todas.
   *
   * Las dos consultas van en la MISMA transacción: si el conteo de excluidos se leyera
   * aparte, podría contar hallazgos de un instante distinto del de las series, y el
   * número que existe para dar contexto daría un contexto falso.
   */
  async recurrence(session: SessionScope, query: RecurrenceQuery): Promise<RecurrenceReport> {
    return this.db.withSessionClient(
      session,
      async (client) => {
        const { rows } = await client.query<SeriesRow>(RECURRENCE_SERIES_SQL, [
          query.window_months,
          query.group_by,
        ]);

        const excluded = await client.query<{ excluded_manual_count: number }>(
          EXCLUDED_MANUAL_SQL,
          [query.window_months],
        );

        return {
          // Los dos parámetros vuelven porque el default lo puso el servidor: un cliente
          // que no mandó ninguno tiene que poder mostrar con cuáles se calculó.
          window_months: query.window_months,
          group_by: query.group_by,
          excluded_manual_count: excluded.rows[0]?.excluded_manual_count ?? 0,
          series: rows.map(toSeries),
        };
      },
      // La huella del auditor externo (riesgo I de §5). Explícita y no la del default:
      // el resultado es un reporte y no una lista de filas con `id`, así que el default
      // registraría que la lectura ocurrió pero no qué alcanzó. Lo que alcanzó son los
      // hallazgos de las series, que es lo que un inspector querría poder reconstruir.
      {
        resource: 'finding_recurrence',
        identify: (result) =>
          (result as RecurrenceReport).series.flatMap((series) =>
            series.finding_ids.map((id) => ({ siteId: series.site_id, id })),
          ),
      },
    );
  }
}

interface SeriesRow {
  site_id: string;
  item_key: string;
  item_prompt: string | null;
  location_id: string | null;
  location_count: number;
  occurrence_count: number;
  template_version_item_count: number;
  first_occurred_at: Date;
  last_occurred_at: Date;
  finding_ids: string[];
}

function toSeries(row: SeriesRow): RecurrenceSeries {
  return {
    site_id: row.site_id,
    item_key: row.item_key,
    // Un ítem cuya plantilla ya no lo publica en ninguna versión no tiene redacción que
    // mostrar. La serie sigue existiendo —los hallazgos ocurrieron— y se muestra con su
    // clave, que es el único nombre que le queda.
    item_prompt: row.item_prompt ?? row.item_key,
    location_id: row.location_id,
    location_count: row.location_count,
    occurrence_count: row.occurrence_count,
    template_version_item_count: row.template_version_item_count,
    first_occurred_at: row.first_occurred_at.toISOString(),
    last_occurred_at: row.last_occurred_at.toISOString(),
    finding_ids: row.finding_ids,
  };
}
