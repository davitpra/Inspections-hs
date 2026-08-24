import type { Session } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { AccountChip } from '../components/AccountChip';
import { CrossIcon } from '../components/icons';
import { initials } from '../presentation/account';
import { visibleNavItems } from './nav-items';

/**
 * La barra de escritorio: navegación, marca y cuenta, en una columna propia.
 *
 * La marca no es un link porque `/` ya está en la lista como "Inspections": si el logo
 * también navegara a `/`, habría dos elementos marcados como actuales a la vez.
 *
 * El icono es decorativo: el label lo acompaña siempre, así que el SVG no lleva `aria-label`.
 * Repetirlo para el lector de pantalla solo duplicaría el nombre del destino. El `<span>`
 * que lo envuelve es una caja de ancho fijo: los iconos no miden todos lo mismo por dentro
 * y sin ella los labels arrancaban en sangrías distintas.
 */
export function Sidebar({
  account,
  onSignOut,
}: {
  account: Session;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">
          <CrossIcon size={16} />
        </span>
        <span>Health &amp; Safety</span>
      </div>

      <div className="sidebar__links">
        {visibleNavItems(account).map((item) => (
          <Link
            key={item.to}
            className="sidebar__link"
            to={item.to}
            activeOptions={item.to === '/' ? { exact: true } : undefined}
          >
            <span className="sidebar__link-icon">
              <item.icon size={18} />
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>

      <div className="sidebar__account">
        <div className="sidebar__account-row">
          {/* Decorativo: el nombre entero está escrito al lado. */}
          <span className="sidebar__avatar" aria-hidden>
            {initials(account)}
          </span>
          <AccountChip account={account} />
        </div>
        <button type="button" className="sidebar__signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
