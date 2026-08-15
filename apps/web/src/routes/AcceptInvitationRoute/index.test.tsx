import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptInvitationRoute } from './index';

const acceptInvitation = vi.hoisted(() => vi.fn());
const useSearch = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({ sessionClient: { acceptInvitation } }));

vi.mock('@tanstack/react-router', () => ({
  useSearch,
  useNavigate: () => navigate,
}));

const TOKEN = 'r4nd0m-base64url-token';
const GOOD_PASSWORD = 'correct horse battery';

function tokenField(): HTMLInputElement {
  return screen.getByLabelText('Invitation token') as HTMLInputElement;
}

/** Llenar las dos contraseñas, que es lo que hace falta en casi todos los casos. */
function fillPasswords(password: string, confirmation = password): void {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Repeat the password'), {
    target: { value: confirmation },
  });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('AcceptInvitationRoute', () => {
  beforeEach(() => {
    useSearch.mockReturnValue({ token: TOKEN });
    acceptInvitation.mockResolvedValue({ ok: true, value: undefined });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('precarga el token que viene en el link del coordinador', () => {
    render(<AcceptInvitationRoute />);

    expect(tokenField().value).toBe(TOKEN);
  });

  it('deja el campo vacío y editable cuando el link llegó sin token', () => {
    useSearch.mockReturnValue({});

    render(<AcceptInvitationRoute />);

    expect(tokenField().value).toBe('');

    fireEvent.change(tokenField(), { target: { value: 'pegado a mano' } });

    expect(tokenField().value).toBe('pegado a mano');
  });

  /**
   * El servidor también la rechaza, pero con el 400 genérico del filtro de Zod. Gastar el
   * viaje para recibir "does not match the contract" no le sirve a nadie.
   */
  it('no manda una contraseña de menos de 12 caracteres', async () => {
    render(<AcceptInvitationRoute />);

    fillPasswords('corta');
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 12 characters/);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('no manda nada si las dos contraseñas no coinciden', async () => {
    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD, `${GOOD_PASSWORD}!`);
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('manda el token y la contraseña, y la confirmación no viaja', async () => {
    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD);
    submit();

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith({
        token: TOKEN,
        password: GOOD_PASSWORD,
      });
    });
  });

  /**
   * Los cuatro motivos —no existe, venció, ya se usó, fue revocada— comparten código a
   * propósito. La pantalla no puede insinuar cuál fue.
   */
  it('traduce invitation_invalid a un mensaje genérico y no filtra el del servidor', async () => {
    acceptInvitation.mockResolvedValue({
      ok: false,
      code: 'invitation_invalid',
      message: 'Invitation is invalid, expired, used or revoked',
    });

    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD);
    submit();

    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toMatch(/no longer usable/);
    expect(alert.textContent).not.toMatch(/revoked/);
  });

  it('no muestra crudo el error de un código que no conoce', async () => {
    acceptInvitation.mockResolvedValue({
      ok: false,
      code: 'invalid_request',
      message: 'The request body does not match the contract',
    });

    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD);
    submit();

    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toMatch(/Something went wrong/);
    expect(alert.textContent).not.toMatch(/contract/);
  });

  /**
   * Encontrado corriéndolo en el navegador: sin este caso el botón se queda en "Setting
   * password…" para siempre y la pantalla no dice nada. Es el fallo más probable de todos
   * —alguien abre el link desde el teléfono, con mala señal— y era el único invisible.
   */
  it('no se queda colgada cuando el fetch rechaza', async () => {
    acceptInvitation.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD);
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Check your connection/);
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy();
  });

  it('reemplaza el formulario por el aviso de éxito y manda a iniciar sesión', async () => {
    render(<AcceptInvitationRoute />);

    fillPasswords(GOOD_PASSWORD);
    submit();

    expect(await screen.findByText('Your password is set')).toBeTruthy();
    expect(screen.queryByLabelText('Invitation token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));

    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });
});
