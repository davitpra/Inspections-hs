import { useNavigate, useSearch } from '@tanstack/react-router';
import { passwordSchema } from '@hs/contracts';
import { useState } from 'react';

import { sessionClient } from '../api/client';

/**
 * Aceptar la invitación y elegir contraseña. La pantalla que faltaba: el endpoint existe
 * desde ADR-011 y hasta ahora toda cuenta nueva pasaba por `curl`.
 *
 * Es la única puerta por la que una cuenta pasa de existir a poder iniciar sesión, y es
 * TAMBIÉN el camino del reinicio de contraseña: sin correo transaccional (design D9) no
 * hay link que mandar, así que el coordinador revoca la credencial, emite una invitación
 * nueva y el titular vuelve acá. Las dos situaciones se ven igual desde esta pantalla, y
 * por eso no hay ningún texto que diga "welcome" ni asuma que la cuenta es nueva.
 *
 * PÚBLICA: quien llega no tiene sesión —su credencial es el token— y por eso `Shell`
 * la deja pasar sin cuenta. No hay barra de navegación: todavía no hay a dónde ir.
 */
export function AcceptInvitationRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ from: '/accept-invitation' });

  // El token viene en el link que reparte el coordinador, y el campo queda editable: si
  // el link se rompió al copiarse en un chat, pegarlo a mano es la salida.
  const [token, setToken] = useState(search.token ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalidPassword, setInvalidPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setInvalidPassword(false);

    // Se valida acá y no se deja fallar al servidor: `ZodExceptionFilter` contesta 400 con
    // "The request body does not match the contract", que es correcto para un contrato
    // roto y no le dice nada a alguien que puso once caracteres.
    const checked = passwordSchema.safeParse(password);

    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? 'That password cannot be used.');
      setInvalidPassword(true);
      return;
    }

    // La confirmación no viaja: es la única contraseña que se fija sin presentar la
    // anterior, así que un dedazo acá deja la cuenta afuera y obliga al coordinador a
    // revocar y emitir otra invitación.
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      setInvalidPassword(true);
      return;
    }

    setBusy(true);

    // `AuthedResult` no cubre el `fetch` que RECHAZA —sin red, DNS caído, CORS— y ese es
    // exactamente el caso de alguien abriendo un link que le mandaron por mensaje. Sin
    // esto la promesa queda sin atrapar y el botón se queda en "Setting password…" para
    // siempre, que es la única forma de fallar que no le dice nada a nadie.
    const result = await sessionClient
      .acceptInvitation({ token: token.trim(), password })
      .catch(() => ({ ok: false, code: 'unreachable' }) as const);

    if (!result.ok) {
      setError(messageFor(result.code));
      setBusy(false);
      return;
    }

    // El token ya se gastó y la contraseña ya no hace falta en memoria.
    setToken('');
    setPassword('');
    setConfirmation('');
    setBusy(false);
    setDone(true);
  };

  if (done) {
    return (
      <>
        <h1>Your password is set</h1>

        <p className="notice">
          Sign in with your work email and the password you just chose. This invitation
          link will not work again.
        </p>

        <button type="button" onClick={() => void navigate({ to: '/' })}>
          Go to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <h1>Choose your password</h1>

      <form onSubmit={(event) => void submit(event)}>
        <p className="item">
          <label htmlFor="token">Invitation token</label>
          <input
            id="token"
            type="text"
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </p>

        <p className="item">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={invalidPassword}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </p>

        <p className="item">
          <label htmlFor="confirmation">Repeat the password</label>
          <input
            id="confirmation"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={invalidPassword}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </p>

        {error ? (
          <p className="notice notice--warn" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? 'Setting password…' : 'Set password'}
        </button>
      </form>

      <p className="notice">
        At least 12 characters. The HS coordinator issues this link and it expires; if it
        no longer works, ask for a new one.
      </p>
    </>
  );
}

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
function messageFor(code: string): string {
  switch (code) {
    case 'invitation_invalid':
      return 'This invitation link is no longer usable. Ask the HS coordinator to issue a new one.';

    default:
      return 'Something went wrong setting your password. Check your connection and try again.';
  }
}
