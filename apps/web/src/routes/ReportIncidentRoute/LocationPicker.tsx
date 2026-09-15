import type { Location } from '@hs/contracts';

import { locationsOfSite } from './presentation';

/** Elige una ubicación activa de la planta seleccionada, nunca un id escrito a mano. */
export function LocationPicker({
  locations,
  siteId,
  value,
  onChange,
}: {
  locations: readonly Location[];
  siteId: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const options = locationsOfSite(locations, siteId);

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose a location</option>
      {options.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      ))}
    </select>
  );
}
