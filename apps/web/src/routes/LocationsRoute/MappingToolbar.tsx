import type { Site } from '@hs/contracts';

import { SearchIcon } from '../../components/icons';
import type { CoverageFilter } from './presentation';

/**
 * Buscar y filtrar por cobertura.
 *
 * El mock tiene cuatro botones fijos porque hay dos plantas. Acá salen del alcance: «All»,
 * «Every plant», y una por planta. CON UNA SOLA PLANTA NO SE DIBUJA — «All» y «Every plant»
 * dirían lo mismo y el tercero también, que es un control que no controla nada (mismo
 * criterio que `SitePicker`).
 */
export function MappingToolbar({
  sites,
  filter,
  onFilter,
  query,
  onQuery,
  showing,
  total,
}: {
  sites: readonly Site[];
  filter: CoverageFilter;
  onFilter: (next: CoverageFilter) => void;
  query: string;
  onQuery: (next: string) => void;
  showing: number;
  total: number;
}): React.JSX.Element {
  // «Todas», «en todas las plantas», y una por planta. Con una sola planta las dos primeras
  // dicen lo mismo, así que el segmentado se reduce a nada útil y no se dibuja.
  const segments: { key: string; label: string; value: CoverageFilter }[] = [
    { key: 'all', label: 'All', value: 'all' },
    { key: 'every', label: 'Every plant', value: 'every' },
    ...sites.map((site) => ({
      key: site.id,
      label: `${site.name} only`,
      value: { only: site.id } as CoverageFilter,
    })),
  ];

  const isActive = (value: CoverageFilter): boolean =>
    typeof value === 'string' || typeof filter === 'string'
      ? value === filter
      : value.only === filter.only;

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
        <div className="view-toggle" role="group" aria-label="Filter by plant">
          {segments.map((segment) => (
            <button
              key={segment.key}
              type="button"
              className="view-toggle__button"
              aria-pressed={isActive(segment.value)}
              onClick={() => onFilter(segment.value)}
            >
              {segment.label}
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
