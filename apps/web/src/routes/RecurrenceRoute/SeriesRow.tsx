import type { RecurrenceSeries } from '@hs/contracts';

import { formatDay } from '../../presentation/dates';

/**
 * Una serie: el ítem que se repitió, y los hallazgos que la componen listados por id.
 *
 * Cerrada por default. Lo que se ve de un vistazo es el prompt y el conteo; lo que hay
 * que poder verificar —los ids— está a un clic y no a una llamada de teléfono.
 */
export function SeriesRow({ series }: { series: RecurrenceSeries }): React.JSX.Element {
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
