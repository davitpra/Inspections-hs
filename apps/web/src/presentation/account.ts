import { ROLE_LABELS, type Session } from '@hs/contracts';

/**
 * El nombre de una cuenta en pantalla, con dos respaldos, y los respaldos son el punto.
 *
 * `firstName`/`lastName` y `email` son opcionales en `sessionSchema` para que un
 * dispositivo con la sesión cacheada por una versión anterior siga entrando sin red (ver
 * el comentario del esquema). Esa tolerancia solo sirve si acá no queda un hueco: sin
 * nombre se muestra el email, y sin email el rol —que siempre está— alcanza para saber
 * con qué permisos se está trabajando.
 *
 * Compartido entre `AccountChip` (la barra) y la pantalla de inicio del inspector, que
 * nombra al asignado en su tira de datos.
 */
export function displayName(account: Session): string {
  const full = [account.firstName, account.lastName].filter(Boolean).join(' ');

  return full || account.email || ROLE_LABELS[account.role];
}
