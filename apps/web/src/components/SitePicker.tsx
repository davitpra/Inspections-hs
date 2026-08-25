import { useId } from 'react';
import type { Site } from '@hs/contracts';

import { activeSites } from '../presentation/sites';
import { ChevronIcon, PinIcon } from './icons';

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
 *
 * LA TARJETA ES DEL COMPONENTE, no de la ruta. Antes cada consola envolvía el selector en
 * su propio `.site-card` con el mismo alfiler adentro, y las dos copias podían separarse
 * sin que nadie lo notara. Acá el control es una sola fila —alfiler, "Site", la planta
 * contra el borde derecho— porque en un teléfono la etiqueta arriba y el `<select>` al
 * ancho completo gastaban dos renglones en decir un dato que cambia poco.
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
    return (
      <p className="site-card">
        <span className="site-card__icon">
          <PinIcon size={22} />
        </span>
        <span className="site-card__label">Site</span>
        <span className="site-card__value">{siteName(value)}</span>
      </p>
    );
  }

  return (
    <div className="site-card">
      <span className="site-card__icon">
        <PinIcon size={22} />
      </span>
      <label className="site-card__label" htmlFor={id}>
        Site
      </label>
      <select
        className="site-card__select"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      {/*
        El chevron es NUESTRO, no el del navegador: el nativo se pega al texto y no hay
        forma de separarlo, y cada plataforma dibuja uno distinto. Va después del
        `<select>`, que ocupa toda la fila y queda arriba — así el toque cae en el control
        aunque el dedo aterrice sobre la flecha.
      */}
      <span className="site-card__chevron">
        <ChevronIcon size={20} />
      </span>
    </div>
  );
}
