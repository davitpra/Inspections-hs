import { useId } from 'react';
import type { Site } from '@hs/contracts';

import { activeSites } from '../presentation/sites';

/**
 * El selector de planta. Con un solo sitio en el alcance degrada a texto: un `<select>`
 * de una opción es un control que no controla nada.
 *
 * SOLO OFRECE PLANTAS ACTIVAS. Elegir una dada de baja no lleva a ningún lado —no tiene
 * reglas, ni períodos, ni roster—, así que ofrecerla es invitar a una pantalla vacía. El
 * filtro vive acá y no en cada ruta para que las dos consolas que lo usan no puedan
 * discrepar; ver `presentation/sites.ts`, que además decide la planta por defecto.
 *
 * Mirar historia sigue funcionando: el nombre de una planta cerrada lo resuelve `siteName`,
 * que la ruta arma con la lista completa de `listSites`. Lo que se recorta es qué se puede
 * ELEGIR, no qué se puede leer.
 *
 * Compartido entre la consola de programación y la del roster — era el mismo control
 * duplicado en las dos.
 */
export function SitePicker({
  sites,
  value,
  onChange,
  siteName,
}: {
  sites: readonly Site[];
  value: string;
  onChange: (siteId: string) => void;
  siteName: (id: string) => string;
}): React.JSX.Element {
  const id = useId();
  const options = activeSites(sites);

  if (options.length <= 1) {
    return <p className="note">Site: {siteName(value)}</p>;
  }

  return (
    <div className="filters">
      <label htmlFor={id}>Site</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </div>
  );
}
