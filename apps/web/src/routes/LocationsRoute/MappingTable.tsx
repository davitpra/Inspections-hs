import type { Location, OrganizationLocation, Site } from '@hs/contracts';

import { LocationRow } from './LocationRow';
import type { SortDirection } from './presentation';

/**
 * La grilla: una fila por ubicación compartida y una columna por planta.
 *
 * Es la tabla de la casa —`.table` pone el ancho, los bordes, el `thead` y el `<th>` de
 * fila— y no una lista con roles escritos a mano: `<table>`, `<tr>`, `<th scope="col">` y
 * `<td>` ya SON `table`, `row`, `columnheader` y `cell`, y `aria-sort` solo significa algo
 * sobre un `columnheader` de verdad. Lo único propio es el número de columnas, que no está
 * escrito en ningún lado: sale del alcance de la cuenta, y el algoritmo de tabla lo reparte
 * mejor de lo que lo repartía un `flex-basis`.
 *
 * `sites` son las columnas QUE SE DIBUJAN: el toggle de la barra las apaga, y apagarlas no
 * toca las filas. El alcance entero lo necesita la barra para ofrecer sus botones, no la
 * tabla, que dibuja lo que le dan.
 *
 * Las dos notas de lista vacía viven acá y no en la ruta porque son la ALTERNATIVA de la
 * tabla: o hay filas, o hay una de las dos. Y son problemas distintos —un catálogo sin dar
 * de alta no es una búsqueda que no encontró nada—, así que se dicen por separado.
 *
 * `direction` llega como valor y no como estado propio: el orden lo consume
 * `visibleLocations` para producir `rows`, así que el estado tiene que quedar arriba.
 */
export function MappingTable({
  sites,
  shared,
  rows,
  locations,
  direction,
  onDirection,
  onRetire,
}: {
  sites: readonly Site[];
  shared: readonly OrganizationLocation[];
  rows: readonly OrganizationLocation[];
  locations: readonly Location[];
  direction: SortDirection;
  onDirection: (next: SortDirection) => void;
  onRetire: (location: OrganizationLocation) => void;
}): React.JSX.Element {
  return (
    <>
      {shared.length === 0 ? (
        <div className="schedule-empty">
          <strong>No shared locations yet.</strong>
          <span>Add one, then tick the plants where it exists.</span>
        </div>
      ) : null}

      {shared.length > 0 && rows.length === 0 ? (
        <div className="schedule-empty">
          <strong>No locations match your search.</strong>
          <span>Try another name, or clear the box.</span>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mapping__table-wrap">
          <table className="table mapping__table" aria-label="Locations by plant">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="mapping__cell--name"
                  aria-sort={direction === 'asc' ? 'ascending' : 'descending'}
                >
                  <button
                    type="button"
                    className="mapping__sort"
                    onClick={() => onDirection(direction === 'asc' ? 'desc' : 'asc')}
                  >
                    Location <span aria-hidden>{direction === 'asc' ? '↑' : '↓'}</span>
                    <span className="mapping__sr">
                      {direction === 'asc' ? 'sorted A to Z' : 'sorted Z to A'}
                    </span>
                  </button>
                </th>
                {sites.map((site) => (
                  <th key={site.id} scope="col" className="mapping__cell--plant">
                    {site.name}
                  </th>
                ))}
                <th scope="col" className="mapping__cell--actions">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((each) => (
                <LocationRow
                  key={each.id}
                  shared={each}
                  locations={locations}
                  sites={sites}
                  onRetire={onRetire}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
