import type { Location, OrganizationLocation, Site } from '@hs/contracts';

import { RowMenu } from '../../components/RowMenu';
import { PlantTick } from './PlantTick';

/**
 * Una ubicación compartida, y en qué plantas existe.
 *
 * LA FILA YA NO ES DE UNA PLANTA: cruza todas las del alcance, y esa es la razón de ser de la
 * pantalla nueva. La versión anterior mostraba una planta por vez, así que «¿esto existe en
 * las dos?» costaba cambiar de planta y volver a contar.
 *
 * LA COBERTURA NO SE RESUME EN UNA ETIQUETA: la contestan las celdas, y decirla además en un
 * badge es contarla dos veces —dos cuentas que pueden contradecirse, y una que además cambia
 * de significado cuando el toggle apaga una columna—.
 *
 * Retirar está detrás del menú «⋮» de la casa y no en un botón directo: es lo que no se
 * deshace —suelta las físicas de todas las plantas— y por eso cuesta un clic más a propósito.
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
  return (
    <tr>
      <th scope="row" className="mapping__cell--name">
        <span className="mapping__name">{shared.name}</span>
      </th>

      {sites.map((site) => (
        <td key={site.id} className="mapping__cell--plant">
          {/* Visible sólo cuando la fila se apila y el encabezado de columna desaparece. */}
          <span className="mapping__plant-label">{site.name}</span>
          <PlantTick
            shared={shared}
            locations={locations}
            siteId={site.id}
            siteName={site.name}
          />
        </td>
      ))}

      <td className="mapping__cell--actions">
        <div className="table__actions">
          <RowMenu
            label={`More actions for ${shared.name}`}
            actions={[
              {
                label: 'Retire location',
                tone: 'danger',
                onSelect: () => onRetire(shared),
              },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}
