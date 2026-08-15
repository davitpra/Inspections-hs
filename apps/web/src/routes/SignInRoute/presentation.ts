/**
 * El mensaje que ve el usuario, por código tipado del servidor.
 *
 * Se mapea el CÓDIGO y no el texto: `auth.errors.ts` pone el código en el cuerpo
 * justamente para que el cliente no tenga que interpretar una frase en inglés.
 */
export function messageFor(code: string, fallback: string): string {
  switch (code) {
    case 'invalid_credentials':
      // El servidor no distingue email inexistente de contraseña incorrecta, y esta
      // pantalla tampoco puede: distinguirlos la convertiría en un verificador de qué
      // direcciones tienen cuenta.
      return 'That email and password do not match an active account.';

    case 'account_locked':
      return 'Too many failed attempts. Wait a few minutes and try again.';

    default:
      return fallback;
  }
}
