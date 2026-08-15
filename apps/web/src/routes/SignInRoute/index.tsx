import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { sessionClient } from '../../api/client';
import { messageFor } from './presentation';
import { useAppSession } from '../../app/session-context';

/**
 * Iniciar sesión. Es la puerta de entrada al dispositivo y no existía: la etapa 3
 * construyó la captura entera asumiendo que había una cuenta, y no había forma de
 * establecerla.
 *
 * ADR-011 — sin auto-registro. Acá no hay "crear cuenta": toda cuenta la crea el
 * coordinador por invitación, y este formulario solo la usa.
 *
 * **Email y contraseña, y nada más.** El campo del código de seis dígitos vivió acá
 * mientras el segundo factor estuvo en el alcance; `remove-two-factor-for-mvp` lo sacó
 * junto con el resto. Con él se fue el bloque que detectaba una sesión de alcance
 * limitado: sin `purpose` en el contrato, toda sesión que el servidor devuelve es
 * plena, y no hay ningún estado intermedio que esta pantalla tenga que explicar.
 */
export function SignInRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { reload } = useAppSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await sessionClient.signIn({
      email: email.trim().toLowerCase(),
      password,
    });

    if (!result.ok) {
      setError(messageFor(result.code, result.message));
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
