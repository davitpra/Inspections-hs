import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const EMAIL = 'ada.reid@example.com';

const listSites = vi.hoisted(() => vi.fn());
const listPeople = vi.hoisted(() => vi.fn());
const inviteAsJhscMember = vi.hoisted(() => vi.fn());
const getAccount = vi.hoisted(() => vi.fn());
const reissueInvitation = vi.hoisted(() => vi.fn());
const removeJhscAccess = vi.hoisted(() => vi.fn());
const setJhscSeat = vi.hoisted(() => vi.fn());
const importRoster = vi.hoisted(() => vi.fn());
const createPerson = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../api/roster', () => ({
  listPeople,
  inviteAsJhscMember,
  getAccount,
  reissueInvitation,
  removeJhscAccess,
  setJhscSeat,
  importRoster,
  createPerson,
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

/**
 * Una cuenta del roster. Los defaults son los de la fila que más aparece —un miembro del
 * JHSC que ya entra— y cada caso deforma lo que su prueba mira. `jhsc_seat` vive acá y no
 * en cada literal: solo importa en el describe del asiento.
 */
function account(
  overrides: Partial<NonNullable<PersonWithAccount['account']>> = {},
): NonNullable<PersonWithAccount['account']> {
  return {
    id: ACCOUNT,
    role: 'jhsc_member',
    active: true,
    can_sign_in: true,
    email: EMAIL,
    jhsc_seat: false,
    ...overrides,
  };
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

function renderRoute(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {

  return {
    ...render(
    <QueryClientProvider client={client}>
      <RosterRoute />
    </QueryClientProvider>,
    ),
    client,
  };
}

function openRowMenu(personName: string): HTMLElement {
  const button = screen.getByRole('button', { name: `More actions for ${personName}` });
  fireEvent.click(button);
  return within(button.parentElement as HTMLElement).getByRole('menu');
}

function clickRowAction(personName: string, action: string): void {
  fireEvent.click(within(openRowMenu(personName)).getByRole('menuitem', { name: action }));
}

beforeEach(() => {
  listSites.mockReset().mockResolvedValue([site()]);
  listPeople.mockReset().mockResolvedValue([person()]);
  inviteAsJhscMember.mockReset();
  getAccount.mockReset();
  reissueInvitation.mockReset();
  removeJhscAccess.mockReset();
  setJhscSeat.mockReset();
  importRoster.mockReset();
  createPerson.mockReset();
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
    expect(screen.queryByRole('button', { name: 'Import people' })).toBeNull();
  });

  it('el coordinador ve el roster de su planta', async () => {
    renderRoute();

    expect(await screen.findByRole('rowheader', { name: 'Reid, Ada' })).toBeTruthy();
    expect(screen.getByText('10472')).toBeTruthy();
  });
});

describe('importar el roster', () => {
  const successfulReport = {
    import_id: '88888888-8888-4888-8888-888888888888',
    source_filename: 'people.csv',
    rows_read: 4,
    rows_applied: 2,
    rows_rejected: 2,
    rejections: [
      { row_number: 5, employee_number: '4', reason: 'Unknown site code' },
      { row_number: 2, employee_number: null, reason: 'Missing employee number' },
    ],
  };

  async function openImport(): Promise<HTMLInputElement> {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Import people' }));
    return screen.getByLabelText('People CSV file') as HTMLInputElement;
  }

  it('no permite enviar sin archivo', async () => {
    await openImport();

    expect((screen.getAllByRole('button', { name: 'Import people' })[1] as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('pending impide el segundo envío y el cierre', async () => {
    let resolveImport!: (value: typeof successfulReport) => void;
    importRoster.mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));
    const input = await openImport();
    fireEvent.change(input, { target: { files: [new File(['csv'], 'people.csv')] } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);

    const pending = await screen.findByRole('button', { name: 'Importing…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Importing people');
    const cancel = new Event('cancel', { cancelable: true });
    screen.getByRole('dialog', { name: 'Import people' }).dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(pending);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(importRoster).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeTruthy();

    resolveImport(successfulReport);
    await screen.findByText('4 rows read, 2 applied, 2 rejected.');
  });

  it('el éxito invalida todo el prefijo y deja los conteos visibles', async () => {
    importRoster.mockResolvedValue(successfulReport);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderRoute(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Import people' }));
    fireEvent.change(screen.getByLabelText('People CSV file'), {
      target: { files: [new File(['csv'], 'people.csv')] },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);

    expect(await screen.findByText('4 rows read, 2 applied, 2 rejected.')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster'] });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it.each([
    ['parcial', successfulReport],
    ['total', { ...successfulReport, rows_applied: 0, rows_rejected: 4 }],
  ])('lista en orden los rechazos de un resultado %s', async (_kind, report) => {
    importRoster.mockResolvedValue(report);
    const input = await openImport();
    fireEvent.change(input, { target: { files: [new File(['csv'], 'people.csv')] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);

    const rejected = await screen.findByRole('region', { name: 'Rejected rows' });
    expect(rejected.textContent).toMatch(/Row 2:.*Row 5:/);
  });

  it.each([
    ['400', 'roster_file_unusable', 'The file is not a usable roster CSV'],
    ['413', 'roster_file_too_large', 'The file is larger than 2 MiB'],
  ])('retiene el diálogo ante un error %s', async (_status, code, message) => {
    importRoster.mockRejectedValue(Object.assign(new Error(message), { code }));
    const input = await openImport();
    fireEvent.change(input, { target: { files: [new File(['csv'], 'people.csv')] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('cambiar el archivo limpia un resultado anterior', async () => {
    importRoster.mockResolvedValue(successfulReport);
    const input = await openImport();
    fireEvent.change(input, { target: { files: [new File(['a'], 'first.csv')] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);
    await screen.findByText('4 rows read, 2 applied, 2 rejected.');

    fireEvent.change(input, { target: { files: [new File(['b'], 'second.csv')] } });

    expect(screen.queryByText('4 rows read, 2 applied, 2 rejected.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Rejected rows' })).toBeNull();
  });

  it('cerrar y reabrir empieza limpio y devuelve el foco a la acción', async () => {
    importRoster.mockResolvedValue(successfulReport);
    const input = await openImport();
    const trigger = screen.getAllByRole('button', { name: 'Import people' })[0]!;
    fireEvent.change(input, { target: { files: [new File(['a'], 'people.csv')] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import people' })[1]!);
    await screen.findByText('4 rows read, 2 applied, 2 rejected.');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);

    expect((screen.getByLabelText('People CSV file') as HTMLInputElement).files).toHaveLength(0);
    expect(screen.queryByText('4 rows read, 2 applied, 2 rejected.')).toBeNull();
  });
});

describe('agregar una persona (add-person-to-roster-by-hand)', () => {
  async function openAdd(): Promise<void> {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add person' }));
    await screen.findByRole('dialog', { name: 'Add person' });
  }

  function fillForm(): void {
    fireEvent.change(screen.getByLabelText('Employee number'), { target: { value: 'NEW-1' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
  }

  it('se abre desde el encabezado', async () => {
    await openAdd();

    expect(screen.getByText(/Adds one person to St. Thomas/i)).toBeTruthy();
  });

  it('manda el site_id que el selector muestra', async () => {
    createPerson.mockResolvedValue({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      site_id: SITE,
      employee_number: 'NEW-1',
      first_name: 'Grace',
      last_name: 'Hopper',
      deactivated_at: null,
    });

    await openAdd();
    fillForm();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[1]!);

    await waitFor(() =>
      expect(createPerson).toHaveBeenCalledWith({
        site_id: SITE,
        employee_number: 'NEW-1',
        first_name: 'Grace',
        last_name: 'Hopper',
      }),
    );
  });

  it('invalida el roster de esa planta, la persona aparece y el diálogo se cierra', async () => {
    const created = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      site_id: SITE,
      employee_number: 'NEW-1',
      first_name: 'Grace',
      last_name: 'Hopper',
      deactivated_at: null,
    };
    createPerson.mockResolvedValue(created);
    listPeople.mockResolvedValueOnce([person()]).mockResolvedValue([
      person(),
      { ...created, account: null },
    ]);

    await openAdd();
    fillForm();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[1]!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('rowheader', { name: 'Hopper, Grace' })).toBeTruthy();
  });

  it('el foco vuelve al disparador al cerrar', async () => {
    await openAdd();
    const trigger = screen.getAllByRole('button', { name: 'Add person' })[0]!;

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('el error del servidor se ve sin cerrar el diálogo', async () => {
    createPerson.mockRejectedValue(
      Object.assign(new Error('employee_number "NEW-1" is already in use'), {
        code: 'person_employee_number_taken',
      }),
    );

    await openAdd();
    fillForm();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[1]!);

    expect((await screen.findByRole('alert')).textContent).toContain('already in use');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('un rol que no es coordinador no ve el botón', async () => {
    useAppSession.mockReturnValue(session('supervisor'));

    renderRoute();

    expect(await screen.findByText(/Only the H&S coordinator/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
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

    fireEvent.click(await screen.findByLabelText('Site'));
    fireEvent.click(screen.getByRole('option', { name: 'Glencoe' }));

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE_B));
  });

  /**
   * La baja no saca la planta de `user_site_scope`: sigue en el alcance y en `GET /sites`.
   * Sin filtro, el selector la ofrece y la consola llega a abrir en ella.
   */
  it('no ofrece una planta dada de baja, y pide el roster de la activa', async () => {
    const closed = { ...site(SITE, 'St. Thomas'), deactivated_at: '2026-08-21T12:00:00.000Z' };
    useAppSession.mockReturnValue(session('hs_coordinator', [SITE, SITE_B]));
    listSites.mockResolvedValue([closed, site(SITE_B, 'Glencoe')]);

    renderRoute();

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE_B));
    expect(listPeople).not.toHaveBeenCalledWith(SITE);
    expect(await screen.findByText('Glencoe')).toBeTruthy();
  });

  it('sin ninguna planta activa lo dice y no pide roster', async () => {
    const closed = { ...site(SITE, 'St. Thomas'), deactivated_at: '2026-08-21T12:00:00.000Z' };
    listSites.mockResolvedValue([closed]);

    renderRoute();

    expect(await screen.findByText('No active sites.')).toBeTruthy();
    expect(listPeople).not.toHaveBeenCalled();
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

    for (const name of ['Name', 'Employee #', 'Role', 'Email', 'Access / Status', 'Actions']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy();
    }

    // El encabezado más la fila de Ada.
    expect(screen.getAllByRole('row').length).toBe(2);
    expect(screen.getByRole('rowheader', { name: 'Reid, Ada' })).toBeTruthy();
  });

  it('sin nadie que mostrar no dibuja una tabla vacía con encabezados', async () => {
    listPeople.mockResolvedValue([]);

    renderRoute();
    await screen.findByText(/No people have been added/);

    expect(screen.queryByRole('table')).toBeNull();
  });

  it('nombra la pantalla y la lista sin usar roster', async () => {
    renderRoute();

    expect(await screen.findByRole('heading', { name: 'People & Access' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import people' })).toBeTruthy();
    expect(screen.queryByText(/roster/i)).toBeNull();
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
    listPeople.mockResolvedValue([person({ account: account() })]);

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

  /**
   * La columna Email: a qué dirección se invitó a cada quien, sin abrir el diálogo de
   * reemisión cuenta por cuenta.
   */
  it('la fila con cuenta muestra su correo y la que no tiene deja la celda vacía', async () => {
    listPeople.mockResolvedValue([
      person({
        id: ADA,
        account: account(),
      }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: null,
      }),
    ]);

    renderRoute();

    expect(await screen.findByText(EMAIL)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  /**
   * Misma regla que la celda Role: para el roster, la cuenta a la que se le quitó el acceso
   * no existe. Mostrar su correo diría que esa dirección todavía tiene acceso.
   */
  it('la cuenta inactiva no muestra correo', async () => {
    listPeople.mockResolvedValue([
      person({
        account: account({ active: false, can_sign_in: false }),
      }),
    ]);

    renderRoute();

    await screen.findByText('Worker');
    expect(screen.queryByText(EMAIL)).toBeNull();
  });

  it('una persona sin cuenta ofrece el botón y una con cuenta no', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: null }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: account(),
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(within(openRowMenu('Reid, Ada')).getByRole('menuitem', { name: 'Invite to JHSC' })).toBeTruthy();
    expect(within(openRowMenu('Alvarez, Bruno')).queryByRole('menuitem', { name: 'Invite to JHSC' })).toBeNull();
  });

  it('invitar vuelve a pedir el roster', async () => {
    inviteAsJhscMember.mockResolvedValue({
      account: account({ can_sign_in: false }),
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    const callsBefore = listPeople.mock.calls.length;

    clickRowAction('Reid, Ada', 'Invite to JHSC');

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
      account: account({ can_sign_in: false }),
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });
    listPeople
      .mockResolvedValueOnce([person()])
      .mockResolvedValue([
        person({
          account: account({ can_sign_in: false }),
        }),
      ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'Invite to JHSC');

    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate link/i }));

    // La fila ya muestra el rol —el refetch llegó— y el link sigue en pantalla, en el modal.
    expect(await screen.findByText('JHSC member (invited)')).toBeTruthy();
    expect(within(openRowMenu('Reid, Ada')).queryByRole('menuitem', { name: 'Invite to JHSC' })).toBeNull();
    expect(screen.getByRole('button', { name: /Copy invitation link/i })).toBeTruthy();
  });

  it('el token se muestra una vez y no queda en la caché', async () => {
    inviteAsJhscMember.mockResolvedValue({
      account: account({ can_sign_in: false }),
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });
    listPeople
      .mockResolvedValueOnce([person()])
      .mockResolvedValue([
        person({
          account: account({ can_sign_in: false }),
        }),
      ]);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'Invite to JHSC');

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

    clickRowAction('Reid, Ada', 'Invite to JHSC');
    fireEvent.change(screen.getByLabelText(/Email for Reid, Ada/i), {
      target: { value: 'ada.reid@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Email for Reid, Ada/i)).toBeNull();
    expect(inviteAsJhscMember).not.toHaveBeenCalled();

    clickRowAction('Reid, Ada', 'Invite to JHSC');
    expect((screen.getByLabelText(/Email for Reid, Ada/i) as HTMLInputElement).value).toBe('');
  });
});

describe('reemitir el link (reissue-invitation-link-from-roster)', () => {
  it('una cuenta invitada ofrece "New link" y no "Invite to JHSC"; una que ya entra no ofrece ninguno', async () => {
    listPeople.mockResolvedValue([
      person({
        id: ADA,
        account: account({ can_sign_in: false }),
      }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: account(),
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    const adaMenu = openRowMenu('Reid, Ada');
    expect(within(adaMenu).getByRole('menuitem', { name: 'New link' })).toBeTruthy();
    expect(within(adaMenu).queryByRole('menuitem', { name: 'Invite to JHSC' })).toBeNull();
    expect(within(openRowMenu('Alvarez, Bruno')).queryByRole('menuitem', { name: 'New link' })).toBeNull();
  });

  it('una persona sin cuenta no ofrece "New link"', async () => {
    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(within(openRowMenu('Reid, Ada')).queryByRole('menuitem', { name: 'New link' })).toBeNull();
  });

  it('precarga el email registrado y no deja emitir mientras carga', async () => {
    listPeople.mockResolvedValue([
      person({
        account: account({ can_sign_in: false }),
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

    clickRowAction('Reid, Ada', 'New link');

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
        account: account({ can_sign_in: false }),
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
      account: account({ can_sign_in: false }),
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'New link');
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
        account: account({ can_sign_in: false }),
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
      account: account({ can_sign_in: false }),
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'New link');

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
  const invited = account({ can_sign_in: false });
  const member = account();
  const removed = account({ active: false, can_sign_in: false });

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

    const adaMenu = openRowMenu('Reid, Ada');
    expect(within(adaMenu).getByRole('menuitem', { name: 'Cancel invitation' })).toBeTruthy();
    expect(within(openRowMenu('Alvarez, Bruno')).getByRole('menuitem', { name: 'Remove' })).toBeTruthy();
    expect(within(adaMenu).queryByRole('menuitem', { name: 'Remove' })).toBeNull();
  });

  // El roster administra el acceso que el roster otorga. Un supervisor no se toca de acá.
  it('no ofrece quitar el acceso de una cuenta que no es jhsc_member', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: { ...member, role: 'supervisor' } }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: 'More actions for Reid, Ada' })).toBeNull();
  });

  it('confirma antes de quitar, y solo llama al servidor al confirmar', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: member })]);
    removeJhscAccess.mockResolvedValue({ account: removed });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'Remove');

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

    clickRowAction('Reid, Ada', 'Cancel invitation');

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
    const menu = openRowMenu('Reid, Ada');
    expect(within(menu).getByRole('menuitem', { name: 'Invite to JHSC' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/i })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'New link' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Cancel invitation' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Remove' })).toBeNull();
  });

  it('vuelve a invitar por el mismo camino que una persona sin cuenta', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: removed })]);
    inviteAsJhscMember.mockResolvedValue({
      account: { ...removed, active: true },
      invitation: { token: 'a-fresh-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    clickRowAction('Reid, Ada', 'Invite to JHSC');

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

    expect(screen.queryByRole('button', { name: 'More actions for Reid, Ada' })).toBeNull();
  });

  // El roster administra el acceso que el roster otorga: la cuenta inactiva de un
  // supervisor no se revive apretando "invitar".
  it('no ofrece invitar cuando la cuenta dada de baja no era de jhsc_member', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: { ...removed, role: 'supervisor' } }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(screen.queryByRole('button', { name: 'More actions for Reid, Ada' })).toBeNull();
  });
});

describe('el asiento en el JHSC (coordinator-jhsc-seat)', () => {
  const coordinator = (jhsc_seat: boolean) => account({ role: 'hs_coordinator', jhsc_seat });

  it('la fila de la coordinadora ofrece sentarse, y la del miembro no ofrece nada', async () => {
    listPeople.mockResolvedValue([
      person({ id: ADA, account: coordinator(false) }),
      person({
        id: BRUNO,
        first_name: 'Bruno',
        last_name: 'Alvarez',
        employee_number: '10473',
        account: account(),
      }),
    ]);

    renderRoute();
    await screen.findByRole('rowheader', { name: 'Reid, Ada' });

    expect(within(openRowMenu('Reid, Ada')).getByRole('menuitem', { name: 'Join JHSC' })).toBeTruthy();
    expect(within(openRowMenu('Alvarez, Bruno')).queryByRole('menuitem', { name: 'Join JHSC' })).toBeNull();
  });

  it('la celda Role dice el asiento de quien lo tiene', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: coordinator(true) })]);

    renderRoute();

    expect(await screen.findByText('H&S coordinator · JHSC seat')).toBeTruthy();
  });

  it('sentarse pide confirmación y recién ahí escribe', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: coordinator(false) })]);
    setJhscSeat.mockResolvedValue({ account: { ...coordinator(true) } });

    renderRoute();

    await screen.findByRole('rowheader', { name: 'Reid, Ada' });
    clickRowAction('Reid, Ada', 'Join JHSC');

    // El diálogo está abierto y todavía no se escribió nada.
    expect(screen.getByRole('heading', { name: /Seat Reid, Ada \(10472\) on the JHSC\?/i })).toBeTruthy();
    expect(setJhscSeat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Seat on the JHSC$/i }));

    await waitFor(() => expect(setJhscSeat).toHaveBeenCalledWith({ userId: ACCOUNT, granted: true }));
  });

  /**
   * Lo que el coordinador podría creer que este botón resuelve, y no: las inspecciones ya
   * asignadas siguen siendo suyas. Si esa frase desaparece, alguien va a levantar a alguien
   * del comité esperando que se reasignen solas.
   */
  it('levantarse avisa que lo ya asignado sigue asignado', async () => {
    listPeople.mockResolvedValue([person({ id: ADA, account: coordinator(true) })]);
    setJhscSeat.mockResolvedValue({ account: { ...coordinator(false) } });

    renderRoute();

    await screen.findByRole('rowheader', { name: 'Reid, Ada' });
    clickRowAction('Reid, Ada', 'Leave JHSC');

    expect(screen.getByText(/Inspections already assigned to them stay assigned/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Remove from the seat$/i }));

    await waitFor(() =>
      expect(setJhscSeat).toHaveBeenCalledWith({ userId: ACCOUNT, granted: false }),
    );
  });
});
