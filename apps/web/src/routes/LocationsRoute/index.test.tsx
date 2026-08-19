import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Location, OrganizationLocation, Session, Site } from '@hs/contracts';

import { LocationsRoute } from './index';

const ST_THOMAS = '11111111-1111-4111-8111-111111111111';
const GLENCOE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';

const DOCK_SHARED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COLD_SHARED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOCK_ST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SPARE_ST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DOCK_GL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const listOrganizationLocations = vi.hoisted(() => vi.fn());
const listCatalogLocations = vi.hoisted(() => vi.fn());
const mapLocation = vi.hoisted(() => vi.fn());
const createOrganizationLocation = vi.hoisted(() => vi.fn());
const createLocation = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/catalog', () => ({
  listOrganizationLocations,
  listCatalogLocations,
  mapLocation,
  createOrganizationLocation,
  createLocation,
}));
vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: [ST_THOMAS, GLENCOE],
      recordsFrom: null,
      recordsTo: null,
    },
  };
}

const sites: Site[] = [
  { id: ST_THOMAS, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  { id: GLENCOE, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
];

const shared: OrganizationLocation[] = [
  { id: DOCK_SHARED, code: 'loading-dock', name: 'Loading dock', deactivated_at: null },
  { id: COLD_SHARED, code: 'cold-storage', name: 'Cold storage', deactivated_at: null },
];

/** St. Thomas mapeó el muelle y tiene una física libre; el frío no está mapeado acá. */
const locations: Location[] = [
  {
    id: DOCK_ST,
    site_id: ST_THOMAS,
    code: 'dock-east',
    name: 'Dock east',
    deactivated_at: null,
    organization_location_code: 'loading-dock',
  },
  {
    id: SPARE_ST,
    site_id: ST_THOMAS,
    code: 'spare-room',
    name: 'Spare room',
    deactivated_at: null,
    organization_location_code: null,
  },
  {
    id: DOCK_GL,
    site_id: GLENCOE,
    code: 'dock-west',
    name: 'Dock west',
    deactivated_at: null,
    organization_location_code: 'loading-dock',
  },
];

function renderRoute(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <LocationsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
  listSites.mockReset().mockResolvedValue(sites);
  listOrganizationLocations.mockReset().mockResolvedValue(shared);
  listCatalogLocations.mockReset().mockResolvedValue(locations);
  mapLocation.mockReset().mockResolvedValue(locations[0]);
  createOrganizationLocation.mockReset().mockResolvedValue(shared[0]);
  createLocation.mockReset().mockResolvedValue(locations[1]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede administrar el catálogo', () => {
  it.each(['jhsc_member', 'supervisor', 'management', 'external_auditor'] as const)(
    'se lo niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only the H&S coordinator can administer locations/)).toBeTruthy();
      expect(listCatalogLocations).not.toHaveBeenCalled();
    },
  );
});

describe('la lista se ordena por ubicación compartida', () => {
  it('muestra una fila por compartida, no por física', async () => {
    renderRoute();

    expect(await screen.findByLabelText('Loading dock')).toBeTruthy();
    expect(screen.getByLabelText('Cold storage')).toBeTruthy();
  });

  /** El hueco que la primera versión no podía dibujar: una fila que no está. */
  it('marca la compartida que no tiene lugar en esta planta', async () => {
    renderRoute();

    await screen.findByLabelText('Cold storage');

    expect((screen.getByLabelText('Cold storage') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Missing here')).toBeTruthy();
  });

  it('cuenta cuántas faltan', async () => {
    renderRoute();

    expect(await screen.findByText('1 of 2 shared locations mapped here')).toBeTruthy();
  });

  it('el select ya trae la física que la representa', async () => {
    renderRoute();

    expect(((await screen.findByLabelText('Loading dock')) as HTMLSelectElement).value).toBe(
      DOCK_ST,
    );
  });

  /**
   * `UNIQUE (site_id, organization_location_id)` rechaza el duplicado, así que ofrecer una
   * física ya tomada sería ofrecer un error de Postgres.
   */
  it('no ofrece una física que ya representa a otra compartida', async () => {
    renderRoute();

    const cold = (await screen.findByLabelText('Cold storage')) as HTMLSelectElement;
    const offered = [...cold.options].map((option) => option.textContent);

    expect(offered).toContain('Spare room');
    expect(offered).not.toContain('Dock east');
  });

  it('no ofrece las físicas de la otra planta', async () => {
    renderRoute();

    const dock = (await screen.findByLabelText('Loading dock')) as HTMLSelectElement;

    expect([...dock.options].map((option) => option.textContent)).not.toContain('Dock west');
  });
});

describe('cambiar de planta', () => {
  it('recalcula el mapeo con las ubicaciones de la otra', async () => {
    renderRoute();

    await screen.findByText('1 of 2 shared locations mapped here');

    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: GLENCOE } });

    expect((screen.getByLabelText('Loading dock') as HTMLSelectElement).value).toBe(DOCK_GL);
    expect(screen.getByText('1 of 2 shared locations mapped here')).toBeTruthy();
  });
});

describe('mapear', () => {
  it('asigna una física a una compartida que no tenía', async () => {
    renderRoute();

    fireEvent.change(await screen.findByLabelText('Cold storage'), {
      target: { value: SPARE_ST },
    });

    await waitFor(() => expect(mapLocation).toHaveBeenCalledWith(SPARE_ST, COLD_SHARED));
    expect(mapLocation).toHaveBeenCalledTimes(1);
  });

  /**
   * El único de la migración 0018 prohíbe que dos físicas de la misma planta apunten a la
   * misma compartida, así que reasignar es soltar y después tomar — en ese orden.
   */
  it('reasignar suelta la anterior antes de tomar la nueva', async () => {
    renderRoute();

    fireEvent.change(await screen.findByLabelText('Loading dock'), {
      target: { value: SPARE_ST },
    });

    await waitFor(() => expect(mapLocation).toHaveBeenCalledTimes(2));
    expect(mapLocation.mock.calls[0]).toEqual([DOCK_ST, null]);
    expect(mapLocation.mock.calls[1]).toEqual([SPARE_ST, DOCK_SHARED]);
  });

  it('desmapear suelta y no toma nada', async () => {
    renderRoute();

    fireEvent.change(await screen.findByLabelText('Loading dock'), { target: { value: '' } });

    await waitFor(() => expect(mapLocation).toHaveBeenCalledWith(DOCK_ST, null));
    expect(mapLocation).toHaveBeenCalledTimes(1);
  });

  /** El error va en la fila que lo causó, no arriba de una lista de once. */
  it('muestra el error en su propia fila', async () => {
    mapLocation.mockRejectedValue(new Error('This organization location is already mapped'));

    renderRoute();

    fireEvent.change(await screen.findByLabelText('Cold storage'), {
      target: { value: SPARE_ST },
    });

    expect(await screen.findByText(/already mapped/)).toBeTruthy();
  });
});

describe('las físicas que ninguna compartida usa', () => {
  it('se listan aparte, porque ninguna plantilla puede nombrarlas', async () => {
    renderRoute();

    expect(await screen.findByText('Not used by any shared location')).toBeTruthy();
    expect(screen.getByText('spare-room')).toBeTruthy();
  });
});

describe('dar de alta', () => {
  it('propone el code desde el nombre', async () => {
    renderRoute();

    const names = await screen.findAllByLabelText('Name');
    fireEvent.change(names[0]!, { target: { value: 'Loading dock' } });

    expect((screen.getAllByLabelText('Code')[0] as HTMLInputElement).value).toBe('loading-dock');
  });

  it('deja de proponerlo en cuanto se lo edita', async () => {
    renderRoute();

    const names = await screen.findAllByLabelText('Name');
    fireEvent.change(names[0]!, { target: { value: 'Loading' } });

    const code = screen.getAllByLabelText('Code')[0]!;
    fireEvent.change(code, { target: { value: 'chosen-by-hand' } });
    fireEvent.change(names[0]!, { target: { value: 'Loading dock' } });

    expect((code as HTMLInputElement).value).toBe('chosen-by-hand');
  });

  it('crea una ubicación compartida sin planta', async () => {
    renderRoute();

    const names = await screen.findAllByLabelText('Name');
    fireEvent.change(names[0]!, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    await waitFor(() =>
      expect(createOrganizationLocation).toHaveBeenCalledWith({
        code: 'boiler-room',
        name: 'Boiler room',
      }),
    );
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('crea una física en la planta elegida', async () => {
    renderRoute();

    const names = await screen.findAllByLabelText('Name');
    fireEvent.change(names[1]!, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!);

    await waitFor(() =>
      expect(createLocation).toHaveBeenCalledWith(ST_THOMAS, {
        code: 'boiler-room',
        name: 'Boiler room',
      }),
    );
  });

  it('el formulario de planta dice a cuál', async () => {
    renderRoute();

    expect(await screen.findByText('Add a location to St. Thomas')).toBeTruthy();
  });

  it('no deja crear sin nombre', async () => {
    renderRoute();

    await screen.findAllByLabelText('Name');

    expect((screen.getAllByRole('button', { name: 'Add' })[0] as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('muestra el rechazo del servidor sin vaciar el formulario', async () => {
    createOrganizationLocation.mockRejectedValue(
      new Error('The code "boiler-room" is already in use'),
    );

    renderRoute();

    const names = await screen.findAllByLabelText('Name');
    fireEvent.change(names[0]!, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    expect(await screen.findByText(/already in use/)).toBeTruthy();
    expect((screen.getAllByLabelText('Name')[0] as HTMLInputElement).value).toBe('Boiler room');
  });
});
