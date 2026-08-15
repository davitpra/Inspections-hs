import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  RECURRENCE_GROUPING_DEFAULT,
  WINDOW_MONTHS_DEFAULT,
  type RecurrenceGrouping,
} from '@hs/contracts';

import { queryKeys } from '../../api/query-keys';
import { getRecurrence } from '../../api/recurrence';
import { ExcludedNotice } from './ExcludedNotice';
import { SeriesRow } from './SeriesRow';
import { seriesKey } from './presentation';

/**
 * Los hallazgos que se repiten, por sitio (etapa 7).
 *
 * Esta pantalla es la respuesta a la frase que §5 riesgo A usa para explicar por qué el
 * sistema existe: «la misma guarda falta cuatro meses seguidos».
 *
 * **SIN GRÁFICOS, SIN LÍNEAS DE TENDENCIA Y SIN NINGÚN NÚMERO AGREGADO POR SERIE**, y no
 * es una simplificación temporal. Un gráfico convierte una consulta verificable —cuatro
 * hallazgos, acá están sus ids— en una superficie de interpretación, y un número
 * agregado por serie es el scoring ponderado que §5 riesgo E sacó de v1 entrando por la
 * ventana. Lo que la pantalla muestra es lo que la consulta contó.
 *
 * **La lista no filtra por sitio.** Un miembro del JHSC de St. Thomas no ve Glencoe
 * porque la política RLS no se lo devuelve, no porque este componente lo descarte.
 */
export function RecurrenceRoute(): React.JSX.Element {
  const [windowMonths, setWindowMonths] = useState(WINDOW_MONTHS_DEFAULT);
  const [groupBy, setGroupBy] = useState<RecurrenceGrouping>(RECURRENCE_GROUPING_DEFAULT);

  const recurrence = useQuery({
    queryKey: queryKeys.recurrence(windowMonths, groupBy),
    queryFn: () => getRecurrence({ windowMonths, groupBy }),
    retry: false,
  });

  return (
    <>
      <h1>Recurring findings</h1>

      <div className="filters">
        <label>
          Window
          <select
            value={windowMonths}
            onChange={(event) => setWindowMonths(Number(event.target.value))}
          >
            {[3, 6, 12, 24, 36, 60].map((months) => (
              <option key={months} value={months}>
                Last {months} months
              </option>
            ))}
          </select>
        </label>

        {/*
          Los dos modos de §6-bis pregunta 11. Las etiquetas dicen qué responde cada uno
          y no cómo agrupa: "por ítem y ubicación" no le dice nada a nadie, y la
          diferencia entre arreglar una línea y tener un problema sistémico sí.
        */}
        <label>
          Group by
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as RecurrenceGrouping)}
          >
            <option value="item_location">This item, at this location</option>
            <option value="item">This item, anywhere on site</option>
          </select>
        </label>
      </div>

      {recurrence.isError ? <p className="notice">This view needs a connection.</p> : null}
      {recurrence.isLoading ? <p>Loading…</p> : null}

      {recurrence.data ? (
        <>
          {recurrence.data.series.length === 0 ? (
            <p>Nothing repeated in the last {recurrence.data.window_months} months.</p>
          ) : (
            <ul className="list">
              {recurrence.data.series.map((series) => (
                <SeriesRow key={seriesKey(series)} series={series} />
              ))}
            </ul>
          )}

          <ExcludedNotice count={recurrence.data.excluded_manual_count} />
        </>
      ) : null}
    </>
  );
}
