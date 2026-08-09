import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { sessionClient } from '../api/client';
import { useAppSession } from '../app/session-context';

/**
 * Iniciar sesión. Es la puerta de entrada al dispositivo y no existía: la etapa 3
 * construyó la captura entera asumiendo que había una cuenta, y no había forma de
 * establecerla.
 *
 * ADR-011 — sin auto-registro. Acá no hay "crear cuenta": toda cuenta la crea el
 * coordinador por invitación, y este formulario solo la usa.
 *
 * **UN SOLO FORMULARIO, con el código opcional a la vista.** La tentación es pedir
 * email y contraseña primero y revelar el campo del código solo si el servidor
 * contesta `two_factor_required`. No se hace, y el motivo es concreto: un intento sin
 * código cuenta como intento FALLIDO y suma al bloqueo por reintentos, así que
 * "descubrir" si la cuenta tiene segundo factor le costaría al usuario una de sus
 * oportunidades cada vez que inicia sesión.
 *
 * El inspector —`jhsc_member`, el único rol que ejecuta inspecciones— no necesita
 * segundo factor y deja el campo vacío. Puede tener uno igual, por elección propia, y
 * por eso el campo está.
 */
export function SignInRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { reload } = useAppSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await sessionClient.signIn({
      email: email.trim().toLowerCase(),
      password,
      // La cadena vacía no es un código: se omite, para que el contrato no la rechace.
      ...(code.trim() ? { code: code.trim() } : {}),
    });

    if (!result.ok) {
      setError(messageFor(result.code, result.message));
      setBusy(false);
      return;
    }

    /**
     * Una sesión limitada NO sirve para capturar: el guard del servidor solo la acepta
     * en las rutas de inscripción del segundo factor. Se dice acá, con todas las
     * letras, en vez de dejar que la primera pantalla falle con un 403 que el inspector
     * no puede interpretar.
     *
     * En la práctica le toca al coordinador y a gerencia, que no es quien recorre.
     */
    if (result.value.purpose !== 'full') {
      setError(
        'This account must enrol a second factor before it can be used. Do that on a desktop browser, then sign in again here.',
      );
      setBusy(false);
      return;
    }

    await reload();
    await navigate({ to: '/' });
  };

  return (
    <>
      <h1>Sign in</h1>

      <form onSubmit={(event) => void submit(event)}>
        <p className="item">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </p>

        <p className="item">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </p>

        <p className="item">
          <label htmlFor="code">Six-digit code (only if you set one up)</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </p>

        {error ? (
          <p className="notice notice--warn" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="notice">
        Signing in needs a connection. Once you are in, preparing an inspection is the last
        thing that does — the walkthrough itself runs with no network.
      </p>
    </>
  );
}

/**
 * El mensaje que ve el usuario, por código tipado del servidor.
 *
 * Se mapea el CÓDIGO y no el texto: `auth.errors.ts` pone el código en el cuerpo
 * justamente para que el cliente no tenga que interpretar una frase en inglés.
 */
function messageFor(code: string, fallback: string): string {
  switch (code) {
    case 'invalid_credentials':
      // El servidor no distingue email inexistente de contraseña incorrecta, y esta
      // pantalla tampoco puede: distinguirlos la convertiría en un verificador de qué
      // direcciones tienen cuenta.
      return 'That email and password do not match an active account.';

    case 'two_factor_required':
      return 'This account needs its six-digit code. Enter it above and try again.';

    case 'account_locked':
      return 'Too many failed attempts. Wait a few minutes and try again.';

    case 'two_factor_enrolment_required':
      return 'This account must enrol a second factor before it can be used.';

    default:
      return fallback;
  }
}
