import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  RECURRENCE_GROUPING_DEFAULT,
  WINDOW_MONTHS_DEFAULT,
  type RecurrenceGrouping,
  type RecurrenceSeries,
} from '@hs/contracts';

import { getRecurrence } from '../api/recurrence';
import { formatDay } from './incident-presentation';

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
    queryKey: ['recurrence', windowMonths, groupBy],
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

function SeriesRow({ series }: { series: RecurrenceSeries }): React.JSX.Element {
  return (
    <li className="list__row">
      <details>
        <summary>
          <strong>{series.item_prompt}</strong>{' '}
          <span className="badge">{series.occurrence_count} times</span>
        </summary>

        <dl>
          <dt>First seen</dt>
          <dd>{formatDay(series.first_occurred_at)}</dd>

          <dt>Last seen</dt>
          <dd>{formatDay(series.last_occurred_at)}</dd>

          <dt>Locations</dt>
          <dd>{series.location_id ?? `${series.location_count} across the site`}</dd>

          {/*
            El número que hace auditable el riesgo A: una serie que cruzó tres versiones
            de plantilla lo dice. Si todas dijeran 1 en un sitio con años de ediciones,
            la agrupación estaría partida por la fila publicada y nadie lo notaría.
          */}
          <dt>Template versions crossed</dt>
          <dd>{series.template_version_item_count}</dd>

          <dt>Findings</dt>
          <dd>
            <ul>
              {series.finding_ids.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </details>
    </li>
  );
}

/**
 * Los hallazgos que quedaron fuera de toda serie por no tener `item_key` (design D8).
 *
 * **Se muestra también cuando es cero**, y esa insistencia es el punto: sin este número,
 * "nothing repeated" es indistinguible de "there was nothing to look at". §5 riesgo A
 * dice que el fallo de esta feature no produce ningún error y se ve igual que la
 * ausencia de patrón; esta línea es lo único que separa las dos lecturas en pantalla.
 */
function ExcludedNotice({ count }: { count: number }): React.JSX.Element {
  if (count === 0) {
    return (
      <p className="notice">
        Every finding in this window came from an inspection, so all of them were checked
        against the history.
      </p>
    );
  }

  return (
    <p className="notice">
      {count} finding{count === 1 ? ' was' : 's were'} entered by hand in this window and
      cannot appear in any series: a finding reported outside an inspection has no item to
      group by.
    </p>
  );
}

/** En modo `item` la ubicación es nula, así que la clave de React la omite. */
function seriesKey(series: RecurrenceSeries): string {
  return `${series.site_id}:${series.item_key}:${series.location_id ?? 'all'}`;
}
