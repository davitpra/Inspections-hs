import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person, Session, Site } from '@hs/contracts';

import { RosterRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';
const ADA = '55555555-5555-4555-8555-555555555555';
const BRUNO = '66666666-6666-4666-8666-666666666666';

const listSites = vi.hoisted(() => vi.fn());
const listPeople = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../api/roster', () => ({ listPeople }));
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

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: ADA,
    site_id: SITE,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
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

    expect(await screen.findByText(/Reid, Ada \(10472\)/)).toBeTruthy();
  });
});

describe('la lista', () => {
  it('pide las activas por defecto', async () => {
    renderRoute();

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE, 'active'));
  });

  /**
   * El corazón de la pantalla: ver el roster POR SITIO. Con dos plantas en el alcance
   * aparece el selector, y elegir la otra vuelve a pedir con ese `site_id`.
   */
  it('cambiar de planta vuelve a pedir con la otra', async () => {
    useAppSession.mockReturnValue(session('hs_coordinator', [SITE, SITE_B]));
    listSites.mockResolvedValue([site(), site(SITE_B, 'Glencoe')]);

    renderRoute();
    await screen.findByText(/Reid, Ada/);

    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: SITE_B } });

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE_B, 'active'));
  });

  it('con una sola planta en el alcance no dibuja un selector que no elige nada', async () => {
    renderRoute();
    await screen.findByText(/Reid, Ada/);

    expect(screen.queryByLabelText('Site')).toBeNull();
  });

  it('el filtro de estado vuelve a pedir al servidor', async () => {
    renderRoute();
    await screen.findByText(/Reid, Ada/);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });

    await waitFor(() => expect(listPeople).toHaveBeenCalledWith(SITE, 'all'));
  });

  it('la búsqueda filtra en el cliente, sin volver a pedir', async () => {
    listPeople.mockResolvedValue([
      person(),
      person({ id: BRUNO, employee_number: '10473', first_name: 'Bruno', last_name: 'Alvarez' }),
    ]);

    renderRoute();
    await screen.findByText(/Reid, Ada/);

    const callsBefore = listPeople.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '10473' } });

    await waitFor(() => expect(screen.queryByText(/Reid, Ada/)).toBeNull());
    expect(screen.getByText(/Alvarez, Bruno/)).toBeTruthy();
    expect(listPeople.mock.calls.length).toBe(callsBefore);
  });

  it('distingue "no hay nadie" de "la búsqueda no encontró"', async () => {
    renderRoute();
    await screen.findByText(/Reid, Ada/);

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });

    expect(await screen.findByText(/No one matches/)).toBeTruthy();
  });

  it('dice dónde se corrige lo que muestra', async () => {
    renderRoute();

    expect(await screen.findByText(/maintained by CSV import/i)).toBeTruthy();
  });

  it('no ofrece ningún control de escritura — la consola es de solo lectura', async () => {
    renderRoute();
    await screen.findByText(/Reid, Ada/);

    for (const label of [/deactivate/i, /reactivate/i, /correct name/i, /transfer/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('la pantalla no filtra identificadores', () => {
  it('no muestra ningún uuid', async () => {
    const { container } = renderRoute();
    await screen.findByText(/Reid, Ada/);

    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
