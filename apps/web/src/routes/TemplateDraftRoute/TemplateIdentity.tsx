import type { Site } from '@hs/contracts';
import { useId } from 'react';

import { InfoIcon } from '../../components/icons';
import { ScopePicker } from './ScopePicker';
import { scopeNotice } from './presentation';

/**
 * Lo que la plantilla ES antes de tener una sola pregunta: cómo se llama y dónde se usa.
 *
 * Los dos campos van juntos y arriba de todo porque el segundo condiciona todo lo que
 * sigue: el alcance decide qué ubicaciones puede nombrar cada sección. Dejarlo abajo, o en
 * un panel aparte, haría que el autor escriba media plantilla antes de descubrir que la
 * ubicación que quería no estaba disponible.
 *
 * LA CLAVE VA ACÁ Y DE SOLO LECTURA. El autor no la elige —la deriva el servidor del nombre
 * al crear— y no la puede cambiar. Se muestra igual: renombrar NO la mueve, así que una
 * plantilla renombrada queda con una clave que ya no se le parece, y el día que alguien lea
 * un seed tiene que poder entender por qué.
 */
export function TemplateIdentity({
  name,
  templateKey,
  sites,
  siteIds,
  onName,
  onScope,
}: {
  name: string;
  templateKey: string;
  sites: readonly Site[];
  siteIds: readonly string[];
  onName: (name: string) => void;
  onScope: (siteIds: string[]) => void;
}): React.JSX.Element {
  const controlId = useId();

  return (
    <section className="card builder__identity">
      <div className="builder__identity-grid">
        <div className="builder__field">
          <label className="field-label" htmlFor={`${controlId}-name`}>
            Template name
          </label>
          <input
            id={`${controlId}-name`}
            type="text"
            value={name}
            placeholder="Daily equipment inspection"
            onChange={(event) => onName(event.target.value)}
          />
          <p className="note">
            Give your template a clear name so it&apos;s easy to find. Key <code>{templateKey}</code>
          </p>
        </div>

        <ScopePicker sites={sites} value={siteIds} onChange={onScope} />
      </div>

      {/*
        Lo que el selector no puede decir por sí solo, y que es la mitad del change: el
        alcance no solo dice dónde corre la plantilla, decide qué lugares puede nombrar.
      */}
      <div className="notice-card">
        <div className="notice-card__body">
          <span className="notice-card__icon">
            <InfoIcon size={20} />
          </span>
          <p className="notice-card__text">{scopeNotice(siteIds, sites)}</p>
        </div>
      </div>
    </section>
  );
}
