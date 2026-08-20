import type { Location, Site } from '@hs/contracts';

import { unmappedLocations } from './presentation';

/**
 * El hueco simétrico, por planta.
 *
 * Una física sin compartida no rompe ninguna plantilla, pero es un lugar que ninguna
 * plantilla puede nombrar, y sin esta lista no hay forma de saber que está ahí. Es además
 * donde caen las que se destildan: el tick suelta el mapeo pero nunca borra la fila.
 */
export function Orphans({
  sites,
  locations,
}: {
  sites: readonly Site[];
  locations: readonly Location[];
}): React.JSX.Element | null {
  const byPlant = sites
    .map((site) => ({ site, orphans: unmappedLocations(locations, site.id) }))
    .filter((each) => each.orphans.length > 0);

  if (byPlant.length === 0) return null;

  return (
    <details className="card rules-card">
      <summary>Places no shared location uses</summary>

      <p className="note">
        These places exist in a plant and no template can name them. A finding can still be
        recorded against one by hand. Ticking a location above takes one of these back if the
        code matches.
      </p>

      {byPlant.map(({ site, orphans }) => (
        <div key={site.id}>
          <div className="card__head">
            <h3>{site.name}</h3>
          </div>
          <ul className="list">
            {orphans.map((location) => (
              <li key={location.id} className="list__row">
                <span>{location.name}</span>
                <span className="list__aside">{location.code}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}
