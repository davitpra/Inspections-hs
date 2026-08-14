import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonWithAccount, Session, Site } from '@hs/contracts';

import { RosterRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';
const ADA = '55555555-5555-4555-8555-555555555555';
const BRUNO = '66666666-6666-4666-8666-666666666666';
const ACCOUNT = '77777777-7777-4777-8777-777777777777';

const listSites = vi.hoisted(() => vi.fn());
const listPeople = vi.hoisted(() => vi.fn());
const inviteAsJhscMember = vi.hoisted(() => vi.fn());
const getAccount = vi.hoisted(() => vi.fn());
const reissueInvitation = vi.hoisted(() => vi.fn());
const removeJhscAccess = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../api/roster', () => ({
  listPeople,
  inviteAsJhscMember,
  getAccount,
  reissueInvitation,
  removeJhscAccess,
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(role: Session['role'], siteScope: string[] = [SITE]): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope,
      recordsFrom: null,
      recordsTo: null,
    },
  };
}

function site(id = SITE, name = 'St. Thomas'): Site {
  return { id, code: name.toLowerCase(), name, deactivated_at: null };
}

function person(overrides: Partial<PersonWithAccount> = {}): PersonWithAccount {
  return {
    id: ADA,
    site_id: SITE,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
    account: null,
    ...overrides,
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <RosterRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listSites.mockReset().mockResolvedValue([site()]);
  listPeople.mockReset().mockResolvedValue([person()]);
  inviteAsJhscMember.mockReset();
  getAccount.mockReset();
  reissueInvitation.mockReset();
  removeJhscAccess.mockReset();
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  // `globals: false` desactiva el cleanup automático.
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('quién puede entrar', () => {
  it('a cualquiera que no sea el coordinador le avisa y NO pide nada al servidor', async () => {
    useAppSession.mockReturnValue(session('supervisor'));

    renderRoute();

    expect(await screen.findByText(/Only the H&S coordinator/i)).toBeTruthy();

    // Lo que importa no es el aviso, es que no se dispare una consulta que el servidor
    // va a negar igual.
    expect(listPeople).not.toHaveBeenCalled();
    expect(listSites).not.toHaveBeenCalled();
  });

  it('el coordinador ve el roster de su planta', async () => {
    renderRoute();

    expect(await screen.findByRole('rowheader', { name: 'Reid, Ada' })).toBeTruthy();
    expect(screen.getByText('10472')).toBeTruthy();
  });
});

describe('la lista', () => {
  it('pide el roster de la planta', async () => {
    renderRoute();

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE));
  });

  /**
   * El corazón de la pantalla: ver el roster POR SITIO. Con dos plantas en el alcance
   * aparece el selector, y elegir la otra vuelve a pedir con ese `site_id`.
   */
  it('cambiar de planta vuelve a pedir con la otra', async () => {
    useAppSession.mockReturnValue(session('hs_coordinator', [SITE, SITE_B]));
    listSites.mockResolvedValue([site(), site(SITE_B, 'Glencoe')]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: SITE_B } });

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE_B));
  });

  it('con una sola planta en el alcance no dibuja un selector que no elige nada', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByLabelText('Site')).toBeNull();
  });

  it('la búsqueda filtra en el cliente, sin volver a pedir', async () => {
    listPeople.mockResolvedValue([
      person(),
      person({ id: BRUNO, employee_number: '10473', first_name: 'Bruno', last_name: 'Alvarez' }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    const callsBefore = listPeople.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '10473' } });

    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Reid, Ada' })).toBeNull());
    expect(screen.getByRole('rowheader', { name: 'Alvarez, Bruno' })).toBeTruthy();
    expect(listPeople.mock.calls.length).toBe(callsBefore);
  });

  it('distingue "no hay nadie" de "la búsqueda no encontró"', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });

    expect(await screen.findByText(/No one matches/)).toBeTruthy();
  });

  /**
   * La tabla es lo que deja comparar filas, y comparar necesita que cada dato esté bajo
   * su encabezado. Se prueba por rol accesible y no por clase: lo que importa es que un
   * lector de pantalla anuncie "Employee #, 10472", no cómo se ve la celda.
   */
  it('muestra cada persona como una fila con nombre, número y rol', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    for (const name of ['Name', 'Employee #', 'Role', 'Actions']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy();
    }

    // El encabezado más la fila de Ada.
    expect(screen.getAllByRole('row').length).toBe(2);
    expect(screen.getByRole('rowheader', { name: 'Reid, Ada' })).toBeTruthy();
  });

  it('sin nadie que mostrar no dibuja una tabla vacía con encabezados', async () => {
    listPeople.mockResolvedValue([]);

    renderRoute();
    await screen.findByText(/No one is on the roster/);

    expect(screen.queryByRole('table')).toBeNull();
  });

  it('dice dónde se corrige lo que muestra', async () => {
    renderRoute();

    expect(await screen.findByText(/maintained by CSV import/i)).toBeTruthy();
  });

  it('no ofrece ningún control de escritura — la consola es de solo lectura', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    for (const label of [/deactivate/i, /reactivate/i, /correct name/i, /transfer/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('la pantalla no filtra identificadores', () => {
  it('no muestra ningún uuid', async () => {
    const { container } = renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});

describe('las columnas Role y Actions (proposal)', () => {
  it('el rol se muestra con su etiqueta de dominio, nunca el identificador crudo', async () => {
    listPeople.mockResolvedValue([
      person({ account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: true } }),
    ]);

    renderRoute();

    expect(await screen.findByText('JHSC member')).toBeTruthy();
    expect(screen.queryByText('jhsc_member')).toBeNull();
  });

  /**
   * La mayoría del roster no tiene cuenta, y la celda vacía no distinguía "esta persona no
   * tiene acceso" de "el dato no cargó". "Worker" nombra esa ausencia — no es un rol de
   * `ROLES`, y por eso esa fila sigue ofreciendo invitar.
   */
  it('quien no tiene cuenta se muestra como Worker', async () => {
    listPeople.mockResolvedValue([person({ account: null })]);

    renderRoute();

    expect(await screen.findByText('Worker')).toBeTruthy();
  });

  it('una persona sin cuenta ofrece el botón y una con cuenta no', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: null }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: true },
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.getAllByRole('button', { name: /to JHSC$/i }).length).toBe(1);
  });

  it('invitar vuelve a pedir el roster', async () => {
    inviteAsJhscMember.mockResolvedValue({
      account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    const callsBefore = listPeople.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));

    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate link/i }));

    await waitFor(() => expect(inviteAsJhscMember).toHaveBeenCalledWith({
      personId: ADA,
      email: 'ada.reid@example.com',
      siteId: SITE,
    }));
    await waitFor(() => expect(listPeople.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  /**
   * LA PRUEBA QUE JUSTIFICA `InvitationLink.tsx`, y la que faltaba.
   *
   * Invitar invalida el roster, y el servidor —simulado acá con la segunda respuesta de
   * `listPeople`— ya devuelve a esa persona CON cuenta: la celda deja de renderizar el
   * botón y renderiza el rol, así que la fila que originó la invitación se desmonta. Con
   * el token guardado adentro de `InviteButton` el link se creaba y se perdía en el mismo
   * instante, y el servidor no lo vuelve a dar.
   *
   * Un mock que devuelva SIEMPRE `account: null` no ve nada de esto: la fila nunca se
   * desmonta y el test pasa sobre una pantalla que en producción pierde el token.
   */
  it('el link sobrevive a que la fila pase a mostrar el rol', async () => {
    inviteAsJhscMember.mockResolvedValue({
      account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });
    listPeople
      .mockResolvedValueOnce([person()])
      .mockResolvedValue([
        person({
          account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
        }),
      ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));

    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate link/i }));

    // La fila ya muestra el rol —el refetch llegó— y el link sigue en pantalla, en el modal.
    expect(await screen.findByText('JHSC member (invited)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Copy invitation link/i })).toBeTruthy();
  });

  it('el token se muestra una vez y no queda en la caché', async () => {
    inviteAsJhscMember.mockResolvedValue({
      account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });
    listPeople
      .mockResolvedValueOnce([person()])
      .mockResolvedValue([
        person({
          account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
        }),
      ]);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));

    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate link/i }));

    // El token en claro NUNCA se dibuja: se copia al portapapeles y nada más.
    const copy = await screen.findByRole('button', { name: /Copy invitation link/i });
    expect(screen.queryByText(/a-one-time-token/)).toBeNull();

    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/accept-invitation?token=a-one-time-token'),
      ),
    );

    // Descartado, no hay forma de volver a mostrarlo.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: /Copy invitation link/i })).toBeNull();
  });

  it('cancelar el modal sin generar el link no deja rastro y reabrir empieza vacío', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));
    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Email for Reid, Ada/i)).toBeNull();
    expect(inviteAsJhscMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));
    expect((screen.getByLabelText(/Email for Reid, Ada/i) as HTMLInputElement).value).toBe('');
  });
});

describe('reemitir el link (reissue-invitation-link-from-roster)', () => {
  it('una cuenta invitada ofrece "New link" y no "Invite to JHSC"; una que ya entra no ofrece ninguno', async () => {
    listPeople.mockResolvedValue([
      person({
        id: ADA,
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: true },
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(
      screen.getByRole('button', { name: /New invitation link for Reid, Ada \(10472\)/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /New invitation link for Alvarez, Bruno/i })).toBeNull();
  });

  it('una persona sin cuenta no ofrece "New link"', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: /New invitation link/i })).toBeNull();
  });

  it('precarga el email registrado y no deja emitir mientras carga', async () => {
    listPeople.mockResolvedValue([
      person({
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      }),
    ]);
    getAccount.mockResolvedValue({
      id: ACCOUNT,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      email: 'ada.reid@example.com',
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(
      screen.getByRole('button', { name: /New invitation link for Reid, Ada \(10472\)/i }),
    );

    expect(
      (screen.getByRole('button', { name: /Generate new link/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'ada.reid@example.com',
      ),
    );
    expect(
      (screen.getByRole('button', { name: /Generate new link/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('reemitir sin tocar el correo lo manda sin cambios; el banner de copiar es el mismo de siempre', async () => {
    listPeople.mockResolvedValue([
      person({
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      }),
    ]);
    getAccount.mockResolvedValue({
      id: ACCOUNT,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      email: 'ada.reid@example.com',
    });
    reissueInvitation.mockResolvedValue({
      account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(
      screen.getByRole('button', { name: /New invitation link for Reid, Ada \(10472\)/i }),
    );
    expect(screen.getByText(/previous link stops working/i)).toBeTruthy();

    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'ada.reid@example.com',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Generate new link/i }));

    await waitFor(() =>
      expect(reissueInvitation).toHaveBeenCalledWith({ userId: ACCOUNT, email: undefined }),
    );
    expect(await screen.findByRole('button', { name: /Copy invitation link/i })).toBeTruthy();
    expect(screen.queryByText(/a-fresh-token/)).toBeNull();
  });

  it('corregir el correo antes de emitir lo manda con el request', async () => {
    listPeople.mockResolvedValue([
      person({
        account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      }),
    ]);
    getAccount.mockResolvedValue({
      id: ACCOUNT,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      email: 'ada.reidd@example.com',
    });
    reissueInvitation.mockResolvedValue({
      account: { id: ACCOUNT, role: 'jhsc_member', active: true, can_sign_in: false },
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(
      screen.getByRole('button', { name: /New invitation link for Reid, Ada \(10472\)/i }),
    );

    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'ada.reidd@example.com',
      ),
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate new link/i }));

    await waitFor(() =>
      expect(reissueInvitation).toHaveBeenCalledWith({
        userId: ACCOUNT,
        email: 'ada.reid@example.com',
      }),
    );
  });
});

describe('quitar el acceso (remove-jhsc-access-from-roster)', () => {
  const invited = { id: ACCOUNT, role: 'jhsc_member' as const, active: true, can_sign_in: false };
  const member = { id: ACCOUNT, role: 'jhsc_member' as const, active: true, can_sign_in: true };
  const removed = { id: ACCOUNT, role: 'jhsc_member' as const, active: false, can_sign_in: false };

  it('la invitación pendiente ofrece cancelar; el miembro que ya entra ofrece quitar', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: invited }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: member,
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(
      screen.getByRole('button', { name: /Cancel the invitation of Reid, Ada \(10472\)/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Remove Alvarez, Bruno \(10473\) from JHSC/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Remove Reid, Ada \(10472\) from JHSC/i }),
    ).toBeNull();
  });

  // El roster administra el acceso que el roster otorga. Un supervisor no se toca de acá.
  it('no ofrece quitar el acceso de una cuenta que no es jhsc_member', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: { ...member, role: 'supervisor' } }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: /from JHSC/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel the invitation/i })).toBeNull();
  });

  it('confirma antes de quitar, y solo llama al servidor al confirmar', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: member })]);
    removeJhscAccess.mockResolvedValue({ account: removed });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(
      screen.getByRole('button', { name: /Remove Reid, Ada \(10472\) from JHSC/i }),
    );

    expect(
      screen.getByRole('heading', { name: /Remove Reid, Ada \(10472\) from the JHSC\?/i }),
    ).toBeTruthy();
    expect(screen.getByText(/any session they have open ends/i)).toBeTruthy();
    expect(removeJhscAccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Remove from JHSC$/i }));

    await waitFor(() => expect(removeJhscAccess).toHaveBeenCalledWith({ userId: ACCOUNT }));
  });

  it('la confirmación de una invitación pendiente habla del link, no de sesiones', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: invited })]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(
      screen.getByRole('button', { name: /Cancel the invitation of Reid, Ada \(10472\)/i }),
    );

    expect(screen.getByText(/invitation link stops working/i)).toBeTruthy();
    expect(screen.queryByText(/any session they have open ends/i)).toBeNull();
  });

  /**
   * La fila que queda es la de una persona sin cuenta, y esa es toda la corrección: el
   * coordinador no tiene por qué enterarse de que `person_id` es único ni de que la fila
   * de `app_user` sigue existiendo.
   */
  it('la fila de quien perdió el acceso vuelve a "Worker" y ofrece invitar', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: removed })]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByText(/JHSC member/i)).toBeNull();
    expect(screen.getByText('Worker')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /New invitation link for Reid, Ada/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel the invitation of Reid, Ada/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Reid, Ada/i })).toBeNull();
  });

  it('vuelve a invitar por el mismo camino que una persona sin cuenta', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: removed })]);
    inviteAsJhscMember.mockResolvedValue({
      account: { ...removed, active: true },
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    fireEvent.click(screen.getByRole('button', { name: /Invite Reid, Ada \(10472\) to JHSC/i }));

    // El correo se pide de cero, como en cualquier invitación.
    expect((screen.getByLabelText(/Email for Reid, Ada/i) as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate link/i }));

    await waitFor(() =>
      expect(inviteAsJhscMember).toHaveBeenCalledWith({
        personId: ADA,
        email: 'ada.reid@example.com',
        siteId: SITE,
      }),
    );

    expect(await screen.findByRole('button', { name: /Copy invitation link/i })).toBeTruthy();
  });

  // Misma regla de siempre: a quien ya no trabaja en la planta no se le da acceso.
  it('no ofrece invitar a una persona dada de baja del roster', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, deactivated_at: '2026-01-01T00:00:00.000Z', account: removed }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: /Invite Reid, Ada/i })).toBeNull();
  });

  // El roster administra el acceso que el roster otorga: la cuenta inactiva de un
  // supervisor no se revive apretando "invitar".
  it('no ofrece invitar cuando la cuenta dada de baja no era de jhsc_member', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: { ...removed, role: 'supervisor' } }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: /Invite Reid, Ada/i })).toBeNull();
  });
});
