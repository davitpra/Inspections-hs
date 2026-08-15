import { useEffect, useRef, useState } from 'react';

import { MoreIcon } from './icons';

/** Una entrada del menú. `tone` marca lo que no se deshace, no lo que es importante. */
export interface PeriodAction {
  label: string;
  tone?: 'danger';
  onSelect: () => void;
}

/**
 * El menú de acciones excepcionales de un período: cancelar el que está abierto, volver a
 * programar el que se canceló. Nunca las dos —son estados distintos del mismo mes— y por
 * eso las decide `PeriodRow` y no este componente.
 *
 * Estas acciones salieron del cuerpo de la tarjeta a propósito. La que el coordinador hace
 * doce veces al año es asignar, y esa es la que se ve; estas dos abren un período o lo
 * cierran para siempre, y repetirlas como botón en cada mes las vuelve tan cotidianas como
 * la otra. Acá cuestan un clic más, que es exactamente lo que se quiere que cuesten.
 *
 * `menu`/`menuitem` y no un `<dialog>`: no bloquea nada, se cierra con Escape y al salir
 * el foco del bloque, que es lo que hace un menú cuando se lo maneja con teclado.
 */
export function PeriodMenu({
  label,
  actions,
}: {
  label: string;
  actions: readonly PeriodAction[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div
      className="period__menu"
      // El foco se va del bloque entero, no solo del botón: `relatedTarget` es el nodo que
      // lo recibe, y si sigue adentro del menú no hay nada que cerrar.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="period__menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <MoreIcon />
      </button>

      {open ? (
        <div className="period__menu-list" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={
                action.tone === 'danger'
                  ? 'period__menu-item period__menu-item--danger'
                  : 'period__menu-item'
              }
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
