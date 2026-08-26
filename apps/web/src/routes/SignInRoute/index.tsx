import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { CrossIcon, LockIcon } from '../../components/icons';
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
 *
 * Comparte la tarjeta centrada con la aceptación de invitaciones: `.shell__main` mide
 * 120rem y un formulario corto estirado a ese ancho no se lee como una puerta, se lee
 * como una pantalla a medio cargar. La marca la repite entera —el cuadrado y el nombre—
 * y no la hereda del sidebar, porque acá el sidebar todavía no existe.
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
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <span className="auth__brand-mark">
            <CrossIcon size={18} />
          </span>
          <span>Health &amp; Safety</span>
        </div>

        <div className="auth__card">
          <h1 className="auth__title">Sign in</h1>
          <p className="auth__lede">
            Use the account your coordinator issued you.
          </p>

          <form className="auth__form" onSubmit={(event) => void submit(event)}>
            <div className="auth__field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder="you@company.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="auth__field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? (
              <p className="notice notice--warn" role="alert">
                {error}
              </p>
            ) : null}

            <button className="button--primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Fuera de la tarjeta: no es un campo ni un error, es lo que hay que saber antes
            de bajar al piso de planta. */}
        <p className="auth__note">
          <span className="auth__note-icon">
            <LockIcon size={16} />
          </span>
          <span>
            Signing in needs a connection. Once you are in, preparing an inspection is the
            last thing that does — the walkthrough itself runs with no network.
          </span>
        </p>
      </div>
    </div>
  );
}
