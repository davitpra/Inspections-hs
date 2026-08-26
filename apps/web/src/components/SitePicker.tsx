import { useEffect, useId, useRef, useState } from 'react';
import type { Site } from '@hs/contracts';

import { activeSites } from '../presentation/sites';
import { CheckIcon, ChevronIcon, PinIcon } from './icons';

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
 * LA TARJETA ES DEL COMPONENTE, no de la ruta. El menú también: un `<select>` nativo no
 * permite dibujar el sitio activo ni los alfileres de las alternativas, así que este
 * listbox conserva esas señales en todas las plataformas y mantiene navegación por teclado.
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
  const listId = `${id}-list`;
  const options = activeSites(sites);
  const selectedIndex = Math.max(0, options.findIndex((site) => site.id === value));
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(selectedIndex);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (open) optionRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, open]);

  function openList(index = selectedIndex): void {
    setFocusedIndex((index + options.length) % options.length);
    setOpen(true);
  }

  function choose(siteId: string): void {
    onChange(siteId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(index: number): void {
    setFocusedIndex((index + options.length) % options.length);
  }

  if (options.length <= 1) {
    return (
      <div className="site-picker">
        <span className="site-picker__label">Site</span>
        <p className="site-card site-card--static">
          <span className="site-card__icon">
            <PinIcon size={24} />
          </span>
          <span className="site-card__value">{siteName(value)}</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="site-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="site-picker__label" htmlFor={id}>
        Site
      </label>
      <button
        ref={triggerRef}
        className="site-card site-card--button"
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList(event.key === 'ArrowDown' ? selectedIndex : selectedIndex - 1);
          }
        }}
      >
        <span className="site-card__icon">
          <PinIcon size={24} />
        </span>
        <span className="site-card__value">{siteName(value)}</span>
        <span className="site-card__chevron" data-open={open || undefined}>
          <ChevronIcon size={20} />
        </span>
      </button>
      {open ? (
        <ul className="site-picker__list" id={listId} role="listbox" aria-label="Site">
          {options.map((site, index) => {
            const selected = site.id === value;
            return (
              <li
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className="site-picker__option"
                key={site.id}
                role="option"
                aria-selected={selected}
                tabIndex={index === focusedIndex ? 0 : -1}
                onClick={() => choose(site.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFocus(index + (event.key === 'ArrowDown' ? 1 : -1));
                  } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    moveFocus(event.key === 'Home' ? 0 : options.length - 1);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    choose(site.id);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
              >
                <span className="site-picker__option-icon">
                  {selected ? <CheckIcon size={18} /> : <PinIcon size={22} />}
                </span>
                <span>{site.name}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
