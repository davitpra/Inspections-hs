import { useId } from 'react';
import type { Site } from '@hs/contracts';

/**
 * El selector de planta. Con un solo sitio en el alcance degrada a texto: un `<select>`
 * de una opción es un control que no controla nada.
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

  if (sites.length <= 1) {
    return <p className="note">Site: {siteName(value)}</p>;
  }

  return (
    <div className="filters">
      <label htmlFor={id}>Site</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
            {site.deactivated_at === null ? '' : ' (closed)'}
          </option>
        ))}
      </select>
    </div>
  );
}
