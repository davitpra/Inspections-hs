import { useEffect, useId, useRef, useState } from 'react';

import { CloseIcon } from '../components/icons';

const SHEET_TRANSITION_MS = 180;
type SheetPhase = 'entering' | 'open' | 'closing';

/**
 * El panel que entra desde un costado, y la razón por la que es un `<dialog>` de verdad.
 *
 * Un menú de teléfono se abre con una mano y se cierra sin mirar: `showModal()` da gratis
 * las tres cosas que un `div` con `position: fixed` obliga a escribir a mano y que siempre
 * quedan a medias — el foco atrapado adentro mientras está abierto, Escape para cerrar, y
 * el resto de la pantalla inerte para el lector de pantalla. Es el mismo mecanismo que ya
 * usan los modales del roster y de la programación.
 *
 * El clic en el fondo cierra: el `::backdrop` no recibe eventos propios, pero un clic fuera
 * del panel tiene al `<dialog>` mismo como `target` —el panel se dibuja adentro—, y esa es
 * la comprobación. Sin esto, el gesto más común para descartar un menú no haría nada.
 *
 * **Y aun así el panel necesita un botón de cerrar.** Escape pide teclado y el clic en el
 * fondo pide saber que el fondo cierra: en un teléfono, con guantes, ninguna de las dos es
 * una salida que se vea. El botón está acá y no en cada llamador para que los dos paneles
 * —el menú y la cuenta— se cierren igual, y para que el tercero que se agregue no tenga que
 * acordarse. Por lo mismo el encabezado lleva el `label` escrito: el nombre que el panel ya
 * declaraba para el lector de pantalla pasa a estar también a la vista, al lado de la
 * salida.
 */
export function Sheet({
  side,
  label,
  onClose,
  children,
}: {
  side: 'start' | 'end';
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<SheetPhase>('entering');

  useEffect(() => {
    dialogRef.current?.showModal();

    // La siguiente tarea separa el estado inicial del estado visible y permite que el CSS anime la entrada.
    openTimerRef.current = setTimeout(() => {
      setPhase('open');
      openTimerRef.current = null;
    }, 0);

    return () => {
      if (openTimerRef.current !== null) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const finishClose = (): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dialogRef.current?.close();
  };

  const requestClose = (): void => {
    const dialog = dialogRef.current;
    if (!dialog || phase === 'closing') return;

    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      dialog.close();
      return;
    }

    setPhase('closing');
    closeTimerRef.current = setTimeout(finishClose, SHEET_TRANSITION_MS);
  };

  return (
    <dialog
      ref={dialogRef}
      className={`sheet sheet--${side}`}
      data-state={phase}
      /*
       * `aria-labelledby` y no `aria-label`: el título ahora está escrito en la pantalla, y
       * repetirlo en un atributo dejaría dos nombres que pueden separarse.
       */
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === 'transform' &&
          phase === 'closing'
        ) {
          finishClose();
        }
      }}
    >
      <div className="sheet__head">
        <h2 className="sheet__title" id={titleId}>
          {label}
        </h2>
        <button
          type="button"
          className="sheet__close"
          aria-label={`Close ${label.toLowerCase()}`}
          onClick={requestClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="sheet__body">{children}</div>
    </dialog>
  );
}
