import type { Location, OrganizationLocation, Site } from '@hs/contracts';

import { LocationRow } from './LocationRow';
import { progressLabel, siteProgress, type SortDirection } from './presentation';

/**
 * La grilla: una fila por ubicación compartida y una columna por planta.
 *
 * Roles de tabla sobre la lista: es una tabla de datos dibujada con flex, y sin declararlo
 * `aria-sort` no significa nada —solo vale sobre un `columnheader`—. El encabezado tampoco
 * puede ser `aria-hidden`: tiene adentro un botón, y un foco dentro de algo escondido es un
 * foco que el lector de pantalla no anuncia.
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
        <p className="note">
          No shared locations yet. Add one, then tick the plants where it exists.
        </p>
      ) : null}

      {shared.length > 0 && rows.length === 0 ? (
        <p className="note">No locations match this filter. Try another name, or All.</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="mapping__table" role="table" aria-label="Locations by plant">
          <li className="mapping__row mapping__row--head" role="row">
            <div
              className="mapping__cell mapping__cell--name"
              role="columnheader"
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
            </div>
            {sites.map((site) => (
              <div key={site.id} className="mapping__cell mapping__cell--plant" role="columnheader">
                {site.name}
                {/*
                  El único número que importa, y va acá porque ya no hay una planta elegida a
                  la que ponérselo arriba: sin él hay que contar los ticks de la columna a ojo
                  para saber si falta algo.
                */}
                <span className="mapping__progress">
                  {progressLabel(siteProgress(shared, locations, site.id))}
                </span>
              </div>
            ))}
            <div
              className="mapping__cell mapping__cell--actions"
              role="columnheader"
              aria-label="Actions"
            >
              <span className="mapping__sr">Actions</span>
            </div>
          </li>

          {rows.map((each) => (
            <LocationRow
              key={each.id}
              shared={each}
              locations={locations}
              sites={sites}
              onRetire={onRetire}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
