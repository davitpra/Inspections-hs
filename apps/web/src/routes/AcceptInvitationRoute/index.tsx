import { useNavigate, useSearch } from '@tanstack/react-router';
import { passwordSchema } from '@hs/contracts';
import { useState } from 'react';

import { sessionClient } from '../../api/client';
import {
  CheckIcon,
  CrossIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
} from '../../components/icons';
import { messageFor } from './presentation';

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

  const token = search.token?.trim();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalidPassword, setInvalidPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  /**
   * Lo mismo que en el inicio de sesión, y acá pesa más: esta contraseña se elige una
   * sola vez y sin poder presentar la anterior, así que un dedazo a ciegas deja la cuenta
   * afuera y obliga al coordinador a revocar y emitir otra invitación.
   *
   * Un solo estado para los dos campos, no uno por campo: la repetición existe para
   * atrapar el dedazo que no se ve, y revelar uno mientras el otro sigue en puntos
   * compara contra nada. O se ven las dos o no se ve ninguna.
   */
  const [revealed, setRevealed] = useState(false);

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
      .acceptInvitation({ token: token ?? '', password })
      .catch(() => ({ ok: false, code: 'unreachable' }) as const);

    if (!result.ok) {
      setError(messageFor(result.code));
      setBusy(false);
      return;
    }

    // El token ya se gastó y la contraseña ya no hace falta en memoria.
    setPassword('');
    setConfirmation('');
    setBusy(false);
    setDone(true);
  };

  if (done) {
    return (
      <div className="auth">
        <div className="auth__panel">
          <div className="auth__brand">
            <span className="auth__brand-mark">
              <CrossIcon size={18} />
            </span>
            <span>Walkthrough</span>
          </div>

          <div className="auth__card auth__card--success">
            <span className="auth__success-mark">
              <CheckIcon size={22} />
            </span>
            <h1 className="auth__title">Your password is set</h1>
            <p className="auth__lede">
              Sign in with your work email and the password you just chose. This invitation
              link will not work again.
            </p>
            <button
              className="button--primary"
              type="button"
              onClick={() => void navigate({ to: '/' })}
            >
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <span className="auth__brand-mark">
            <CrossIcon size={18} />
          </span>
          <span>Walkthrough</span>
        </div>

        <div className="auth__card">
          {token ? (
            <>
              <h1 className="auth__title">Choose your password</h1>
              <p className="auth__lede">
                Complete your account using the invitation issued by your coordinator.
              </p>

              <form className="auth__form" onSubmit={(event) => void submit(event)}>
                <div className="auth__field">
                  <label htmlFor="password">New password</label>
                  <div className="auth__reveal">
                    <input
                      id="password"
                      type={revealed ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      aria-invalid={invalidPassword}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    {/* `type="button"`: dentro del `form`, un botón sin tipo envía. */}
                    <button
                      className="auth__reveal-toggle"
                      type="button"
                      aria-controls="password confirmation"
                      aria-pressed={revealed}
                      aria-label={revealed ? 'Hide password' : 'Show password'}
                      onClick={() => setRevealed((shown) => !shown)}
                    >
                      {revealed ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                    </button>
                  </div>
                </div>

                <div className="auth__field">
                  <label htmlFor="confirmation">Repeat the password</label>
                  <div className="auth__reveal">
                    <input
                      id="confirmation"
                      type={revealed ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      aria-invalid={invalidPassword}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <button
                      className="auth__reveal-toggle"
                      type="button"
                      aria-controls="password confirmation"
                      aria-pressed={revealed}
                      aria-label={revealed ? 'Hide password' : 'Show password'}
                      onClick={() => setRevealed((shown) => !shown)}
                    >
                      {revealed ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <p className="notice notice--warn" role="alert">
                    {error}
                  </p>
                ) : null}

                <button className="button--primary" type="submit" disabled={busy}>
                  {busy ? 'Setting password…' : 'Set password'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="auth__title">Invitation link is incomplete</h1>
              <p className="auth__lede" role="alert">
                Ask your coordinator for a new invitation link and open it without changing
                the address.
              </p>
            </>
          )}
        </div>

        <p className="auth__note">
          <span className="auth__note-icon">
            <LockIcon size={16} />
          </span>
          <span>
            Use at least 12 characters. This secure link expires; if it no longer works,
            ask your coordinator for a new one.
          </span>
        </p>
      </div>
    </div>
  );
}
