import type { Site } from '@hs/contracts';

import { SearchIcon } from '../../components/icons';

/**
 * Buscar, y elegir qué plantas se miran.
 *
 * UN BOTÓN POR PLANTA Y SE PRENDEN SUELTOS: Glencoe deja solo la columna de Glencoe, y
 * sumarle St. Thomas devuelve las dos. Ninguno prendido es «todas» —el estado inicial y la
 * forma de salir del toggle—, así que el botón «All» que había antes no hace falta.
 *
 * Lo que se fue con él es el filtro de cobertura («Every plant», «X only»): recortaba FILAS,
 * y escondía justo aquella donde estaba el hueco. Acá elegir columnas no toca las filas.
 *
 * CON UNA SOLA PLANTA NO SE DIBUJA — un toggle único no controla nada, porque apagarlo
 * también muestra esa planta (mismo criterio que `SitePicker`).
 */
export function MappingToolbar({
  sites,
  selected,
  onToggle,
  query,
  onQuery,
  showing,
  total,
}: {
  sites: readonly Site[];
  selected: readonly string[];
  onToggle: (siteId: string) => void;
  query: string;
  onQuery: (next: string) => void;
  showing: number;
  total: number;
}): React.JSX.Element {
  return (
    <div className="mapping__toolbar">
      <label className="mapping__search">
        <SearchIcon />
        <span className="mapping__sr">Search locations</span>
        <input
          type="search"
          value={query}
          placeholder="Search locations"
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>

      {sites.length > 1 ? (
        <div className="view-toggle" role="group" aria-label="Plants shown">
          {sites.map((site) => (
            <button
              key={site.id}
              type="button"
              className="view-toggle__button"
              aria-pressed={selected.includes(site.id)}
              onClick={() => onToggle(site.id)}
            >
              {site.name}
            </button>
          ))}
        </div>
      ) : null}

      <span className="mapping__count">
        {showing} of {total} locations
      </span>
    </div>
  );
}
