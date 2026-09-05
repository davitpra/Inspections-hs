import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { MoreIcon } from './icons';

/** Una entrada del menú. `tone` marca lo que no se deshace, no lo que es importante. */
export interface RowAction {
  label: string;
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * El borde inferior contra el que compite la lista abierta: el del ancestro que recorta
 * —una tabla con `overflow-x` recorta también hacia abajo, porque en CSS un eje `auto`
 * obliga al otro a serlo— y, si no hay ninguno, el de la ventana.
 */
function clippingBox(node: HTMLElement): { top: number; bottom: number } {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflow, overflowX, overflowY } = getComputedStyle(parent);

    if (`${overflow}${overflowX}${overflowY}`.includes('visible')) continue;

    const rect = parent.getBoundingClientRect();

    return { top: rect.top, bottom: rect.bottom };
  }

  return { top: 0, bottom: window.innerHeight };
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
  const [up, setUp] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  /*
   * HACIA ABAJO SALVO QUE ABAJO NO HAYA LUGAR. La última fila de una tabla con `overflow`
   * no tiene dónde desplegar: la lista le suma alto al contenedor y le saca una barra de
   * scroll. Se mide después de montarla y antes de pintar (`useLayoutEffect`), así que el
   * vuelco no parpadea, y se vuelve a medir en cada apertura porque la fila se mueve —una
   * búsqueda, un scroll—. Solo se vuelca si arriba sobra más que abajo: cambiar un recorte
   * por uno peor no es un arreglo.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    const button = buttonRef.current;

    if (!open || !list || !button) {
      setUp(false);

      return;
    }

    const box = clippingBox(list);
    const listRect = list.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    setUp(
      listRect.bottom > box.bottom &&
        buttonRect.top - box.top > box.bottom - buttonRect.bottom,
    );
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
        <div
          ref={listRef}
          className={up ? 'row-menu__list row-menu__list--up' : 'row-menu__list'}
          role="menu"
        >
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
