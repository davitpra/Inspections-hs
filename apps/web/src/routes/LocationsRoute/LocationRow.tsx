import type { Location, OrganizationLocation, Site } from '@hs/contracts';

import { MoreIcon } from '../../components/icons';
import { PlantTick } from './PlantTick';
import { coverage } from './presentation';

const COVERAGE_PILL: Record<'every' | 'some' | 'none', string> = {
  every: 'status-pill status-pill--ready',
  some: 'status-pill status-pill--not-ready',
  none: 'status-pill status-pill--not-ready',
};

/**
 * Una ubicación compartida, y en qué plantas existe.
 *
 * LA FILA YA NO ES DE UNA PLANTA: cruza todas las del alcance, y esa es la razón de ser de la
 * pantalla nueva. La versión anterior mostraba una planta por vez, así que «¿esto existe en
 * las dos?» costaba cambiar de planta y volver a contar.
 *
 * Bajo el nombre va el `code`, no cuántas plantillas lo usan: el `code` es lo que la sección
 * de una plantilla guarda y lo que sale en los reportes, y es el único de los dos que la API
 * ya devuelve.
 */
export function LocationRow({
  shared,
  locations,
  sites,
  onRetire,
}: {
  shared: OrganizationLocation;
  locations: readonly Location[];
  sites: readonly Site[];
  onRetire: (location: OrganizationLocation) => void;
}): React.JSX.Element {
  const siteIds = sites.map((site) => site.id);
  const where = coverage(shared, locations, siteIds);

  const tag = ((): string => {
    if (where === 'every') return sites.length === 1 ? 'Mapped' : 'Every plant';
    if (where === 'none') return 'Not mapped';

    const only = sites.filter(
      (site) => locations.some((l) => l.site_id === site.id && l.organization_location_code === shared.code),
    );

    return `${only.map((site) => site.name).join(', ')} only`;
  })();

  return (
    <li className="mapping__row" role="row">
      <div className="mapping__cell mapping__cell--name" role="cell">
        <span className="mapping__name">
          {shared.name} <span className={COVERAGE_PILL[where]}>{tag}</span>
        </span>
        <span className="mapping__code">{shared.code}</span>
      </div>

      {sites.map((site) => (
        <div key={site.id} className="mapping__cell mapping__cell--plant" role="cell">
          {/* Visible sólo cuando la fila se apila y el encabezado de columna desaparece. */}
          <span className="mapping__plant-label">{site.name}</span>
          <PlantTick
            shared={shared}
            locations={locations}
            siteId={site.id}
            siteName={site.name}
          />
        </div>
      ))}

      <div className="mapping__cell mapping__cell--actions" role="cell">
        <button
          type="button"
          className="mapping__action"
          aria-label={`Actions for ${shared.name}`}
          onClick={() => onRetire(shared)}
        >
          <MoreIcon />
        </button>
      </div>
    </li>
  );
}
