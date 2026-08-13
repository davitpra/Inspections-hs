import { ROLE_LABELS, type Session } from '@hs/contracts';

/**
 * Quién está usando el dispositivo, escrito donde se ve sin buscarlo.
 *
 * No es adorno. ADR-001 asume un dueño, un dispositivo y un firmante, y el envío es el
 * punto de no retorno: antes de firmar, el inspector tiene que poder confirmar que el
 * borrador que tiene delante es el suyo y no el del turno anterior. Hasta ahora la
 * aplicación sabía quién había iniciado sesión y no lo decía en ninguna parte.
 *
 * Va al lado de "Sign out" porque es la misma pregunta: quien duda de con qué cuenta
 * está adentro es quien va a querer salir.
 */
export function AccountChip({ account }: { account: Session }): React.JSX.Element {
  const role = ROLE_LABELS[account.role];
  const name = displayName(account);

  return (
    <div className="account-chip">
      {/*
        `title` con el email cuando el nombre ya ocupa la línea: el detalle que
        desambigua dos cuentas de la misma persona queda a un hover, sin gastar el
        ancho de la barra en una planta donde se mira desde un teléfono.
      */}
      <span className="account-chip__name" title={account.email}>
        {name}
      </span>
      {/* Cuando el nombre YA cayó al rol no se escribe dos veces la misma palabra. */}
      {name === role ? null : <span className="account-chip__role">{role}</span>}
    </div>
  );
}

/**
 * El nombre, con dos respaldos, y los respaldos son el punto.
 *
 * `firstName`/`lastName` y `email` son opcionales en `sessionSchema` para que un
 * dispositivo con la sesión cacheada por una versión anterior siga entrando sin red
 * (ver el comentario del esquema). Esa tolerancia solo sirve si acá no queda un hueco:
 * sin nombre se muestra el email, y sin email el rol —que siempre está— alcanza para
 * saber con qué permisos se está trabajando.
 */
function displayName(account: Session): string {
  const full = [account.firstName, account.lastName].filter(Boolean).join(' ');

  return full || account.email || ROLE_LABELS[account.role];
}
