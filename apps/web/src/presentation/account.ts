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

/**
 * Las iniciales del avatar de la barra: dos letras cuando hay nombre y apellido, una
 * cuando no.
 *
 * Se apoya en `displayName` para el respaldo y por eso nunca queda vacío — un círculo en
 * blanco al lado del nombre se leería como un error de carga, no como una cuenta sin
 * nombre. El avatar es decorativo (`aria-hidden` en `Sidebar`): el nombre entero está
 * escrito al lado, y deletrearle "AR" a un lector de pantalla no agrega nada.
 */
export function initials(account: Session): string {
  const first = account.firstName?.trim();
  const last = account.lastName?.trim();

  if (first && last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();

  return displayName(account).charAt(0).toUpperCase();
}
