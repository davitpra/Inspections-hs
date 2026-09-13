/**
 * El mensaje que ve el usuario, por código tipado del servidor. Se mapea el CÓDIGO y no el
 * texto, igual que en `SignInRoute`.
 *
 * `invitation_invalid` cubre CUATRO motivos —no existe, venció, ya se usó, fue revocada— y
 * el servidor los unifica a propósito. Esta pantalla no puede separarlos aunque quisiera, y
 * no debería: hacerlo la convertiría en un oráculo de qué tokens existieron.
 *
 * Nada más se muestra crudo. Un 400 del filtro de Zod o un 502 de un proxy traen mensajes
 * escritos para un desarrollador, y quien está de este lado no puede hacer nada con ellos.
 */
export function messageFor(code: string): string {
  switch (code) {
    case 'invitation_invalid':
      return 'This invitation link is no longer usable. Ask the coordinator to issue a new one.';

    default:
      return 'Something went wrong setting your password. Check your connection and try again.';
  }
}
