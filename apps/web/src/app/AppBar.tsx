import type { Session } from '@hs/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { AccountChip } from '../components/AccountChip';
import { MenuIcon, PersonIcon } from '../components/icons';
import { Sheet } from './Sheet';
import { sectionTitle, visibleNavItems } from './nav-items';

/**
 * La barra del TELÉFONO: menú, dónde estoy, quién soy. Las pestañas de `router.tsx` son la
 * misma navegación para una pantalla ancha, y CSS muestra una sola de las dos.
 *
 * **Por qué no son las mismas pestañas achicadas.** Son ocho destinos en el peor caso
 * (coordinador). Envueltos ocupaban tres renglones de una pantalla de teléfono; en una tira
 * que se desplaza, los últimos quedaban fuera de vista y no había forma de saber que
 * estaban. Un menú los muestra todos a la vez, y el título ocupa el lugar que dejan.
 *
 * **El título no es decoración: es lo que reemplaza al subrayado de la pestaña activa.** En
 * el escritorio, dónde se está se lee en la barra; acá la barra está cerrada casi siempre,
 * así que el nombre de la pantalla tiene que estar escrito. Y cubre también las pantallas a
 * las que se llega desde otra —la captura, la revisión—, que es donde más falta hace.
 *
 * Es `<h1>`: el nombre de la pantalla es el encabezado de la página, y sin él el teléfono se
 * quedaba sin ninguno hasta el primer `<h2>` de la ruta.
 */
export function AppBar({
  account,
  pathname,
  onSignOut,
}: {
  account: Session;
  pathname: string;
  onSignOut: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<'nav' | 'account' | null>(null);

  /*
   * Navegar cierra el panel. El `<Link>` de adentro ya lo cierra al tocarlo, pero esto cubre
   * lo que el `onClick` no ve: el botón "atrás" del teléfono, que en una PWA es el gesto de
   * cerrar más usado y dejaba el menú abierto sobre una pantalla que ya había cambiado.
   *
   * Se ajusta DURANTE el render y no en un `useEffect`: es estado derivado de la ruta, y en
   * un efecto el panel se dibujaría una vez sobre la pantalla nueva antes de irse.
   */
  const [openedAt, setOpenedAt] = useState(pathname);

  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(null);
  }

  return (
    <>
      <div className="appbar">
        <button
          type="button"
          className="appbar__button"
          aria-label="Open menu"
          aria-expanded={open === 'nav'}
          onClick={() => setOpen('nav')}
        >
          <MenuIcon />
        </button>

        <h1 className="appbar__title">{sectionTitle(pathname)}</h1>

        {/*
          El nombre no entra en una barra de teléfono, pero SÍ tiene que poder leerse: ADR-001
          asume un dueño y un firmante, y confirmar con qué cuenta se está adentro es el paso
          previo a firmar. El ícono abre el panel donde el nombre completo está escrito, así
          que la pregunta sigue teniendo respuesta — a un toque en vez de a la vista.
        */}
        <button
          type="button"
          className="appbar__button"
          aria-label="Account"
          aria-expanded={open === 'account'}
          onClick={() => setOpen('account')}
        >
          <PersonIcon size={24} />
        </button>
      </div>

      {open === 'nav' ? (
        <Sheet side="start" label="Menu" onClose={() => setOpen(null)}>
          <nav className="sheet__nav" aria-label="Main">
            {visibleNavItems(account).map((item) => (
              <Link
                key={item.to}
                className="sheet__link"
                to={item.to}
                // Sin `exact`, la raíz es prefijo de todo y quedaría marcada en cada pantalla.
                activeOptions={item.to === '/' ? { exact: true } : undefined}
                onClick={() => setOpen(null)}
              >
                <span className="sheet__link-icon">
                  <item.icon size={20} />
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </Sheet>
      ) : null}

      {open === 'account' ? (
        <Sheet side="end" label="Account" onClose={() => setOpen(null)}>
          <div className="sheet__account">
            <AccountChip account={account} />
          </div>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </Sheet>
      ) : null}
    </>
  );
}
