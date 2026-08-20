import { useEffect, useRef, useState } from 'react';

import { MoreIcon } from './icons';

/** Una entrada del menú. `tone` marca lo que no se deshace, no lo que es importante. */
export interface RowAction {
  label: string;
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * El menú «⋮» de una fila: lo que se hace de vez en cuando, guardado detrás de un clic.
 *
 * **Vive acá y no en una ruta porque lo usan dos.** Nació en la consola de programación
 * —cancelar un período abierto, reprogramar el que se canceló— y el builder de plantillas
 * necesita exactamente lo mismo en cada sección y en cada pregunta. La convención del repo
 * es que un subcomponente que aparece en dos rutas sube a `components/` en vez de
 * duplicarse, y acá lo que se duplicaría es el manejo de foco y de Escape, que es
 * justamente la parte fácil de escribir mal.
 *
 * QUÉ VA ADENTRO Y QUÉ NO. Lo que se hace todo el tiempo se queda afuera, visible: asignar
 * un mes, escribir una pregunta. Acá adentro va lo que cuesta un clic más A PROPÓSITO
 * —quitar una sección, cancelar un período— y, en el builder, también los movimientos:
 * arrastrar es el camino cómodo, pero «Move up» tiene que seguir existiendo para el
 * teclado y para quien no puede arrastrar (ADR-010).
 *
 * `menu`/`menuitem` y no un `<dialog>`: no bloquea nada, se cierra con Escape y al salir
 * el foco del bloque, que es lo que hace un menú cuando se lo maneja con teclado.
 */
export function RowMenu({
  label,
  actions,
}: {
  label: string;
  actions: readonly RowAction[];
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
      className="row-menu"
      // El foco se va del bloque entero, no solo del botón: `relatedTarget` es el nodo que
      // lo recibe, y si sigue adentro del menú no hay nada que cerrar.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="row-menu__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <MoreIcon />
      </button>

      {open ? (
        <div className="row-menu__list" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={
                action.tone === 'danger' ? 'row-menu__item row-menu__item--danger' : 'row-menu__item'
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
