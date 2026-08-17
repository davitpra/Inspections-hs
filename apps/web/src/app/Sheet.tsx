import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`sheet sheet--${side}`}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <div className="sheet__body">{children}</div>
    </dialog>
  );
}
