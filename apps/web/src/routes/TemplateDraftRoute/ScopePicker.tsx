import type { Site } from '@hs/contracts';

import { BuildingIcon, CheckIcon } from '../../components/icons';
import { scopeOptions } from './presentation';

/**
 * Para qué plantas se escribe esta plantilla.
 *
 * **BOTONES Y NO UN `<select>`**, y es la única decisión de forma que este archivo toma.
 * Son dos o tres opciones que no cambian nunca y que condicionan todo lo que sigue —qué
 * ubicaciones puede nombrar cada sección—: escondidas detrás de un desplegable, el autor
 * tiene que abrirlo para saber en qué está parado. Acá las tres se leen a la vez y la
 * elegida se ve sin interactuar.
 *
 * `aria-pressed` y no `role="radio"`: son botones que aplican un cambio inmediato al
 * documento en edición, no un campo de formulario que se envía después.
 *
 * CON UNA SOLA PLANTA NO SE DIBUJA. «St. Thomas only» sobre una organización de una planta
 * insinúa que hay otra donde la plantilla no vale, y no la hay; el alcance sigue existiendo
 * en el dato, pero no hay nada que elegir.
 */
export function ScopePicker({
  sites,
  value,
  onChange,
}: {
  sites: readonly Site[];
  value: readonly string[];
  onChange: (siteIds: string[]) => void;
}): React.JSX.Element | null {
  const options = scopeOptions(sites);

  if (options.length < 2) return null;

  return (
    <fieldset className="builder__scope">
      <legend className="field-label">Template scope</legend>
      <p className="note">Choose where this template will be used.</p>

      <div className="builder__scope-options">
        {options.map((option) => {
          const chosen =
            option.siteIds.length === value.length &&
            option.siteIds.every((siteId) => value.includes(siteId));

          return (
            <button
              key={option.label}
              type="button"
              className={chosen ? 'builder__scope-option is-chosen' : 'builder__scope-option'}
              aria-pressed={chosen}
              onClick={() => onChange([...option.siteIds])}
            >
              <BuildingIcon size={18} />
              <span>{option.label}</span>
              {chosen ? <CheckIcon size={18} /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
