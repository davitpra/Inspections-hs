import type { Site } from '@hs/contracts';

import { BuildingIcon, CheckIcon } from '../../components/icons';
import { scopeOptions } from './presentation';

/**
 * Para qué plantas se escribe esta plantilla.
 *
 * **TOGGLES Y NO UN `<select>`**: cada planta se lee y se cambia por separado porque el
 * alcance condiciona qué ubicaciones puede nombrar cada sección. Las opciones vienen del
 * catálogo, no de combinaciones fijas, así que una planta nueva recibe el mismo control.
 *
 * `aria-pressed` y no `role="radio"`: son botones que aplican un cambio inmediato al
 * documento en edición, no un campo de formulario que se envía después.
 *
 * El último toggle elegido se deshabilita: el servidor también rechaza un alcance vacío, pero
 * no hace falta dejar que el autor construya uno para recién explicárselo al guardar.
 *
 * CON UNA SOLA PLANTA NO SE DIBUJA: el alcance sigue existiendo en el dato, pero no hay nada
 * que elegir.
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
  const selectedSiteIds = options
    .filter((option) => value.includes(option.siteId))
    .map((option) => option.siteId);

  if (options.length < 2) return null;

  return (
    <fieldset className="builder__scope">
      <legend className="field-label">Template scope</legend>
      <p className="note">Select one or more plants where this template will be used.</p>

      <div className="builder__scope-options">
        {options.map((option) => {
          const chosen = selectedSiteIds.includes(option.siteId);
          const finalSelection = chosen && selectedSiteIds.length === 1;

          return (
            <button
              key={option.siteId}
              type="button"
              className={chosen ? 'builder__scope-option is-chosen' : 'builder__scope-option'}
              aria-pressed={chosen}
              disabled={finalSelection}
              onClick={() =>
                onChange(
                  options
                    .filter(
                      (candidate) =>
                        candidate.siteId !== option.siteId
                          ? selectedSiteIds.includes(candidate.siteId)
                          : !chosen,
                    )
                    .map((candidate) => candidate.siteId),
                )
              }
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
