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
const NEW_COLD_ST = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NEW_SITE = '99999999-9999-4999-8999-999999999999';

const listOrganizationLocations = vi.hoisted(() => vi.fn());
const listCatalogLocations = vi.hoisted(() => vi.fn());
const mapLocation = vi.hoisted(() => vi.fn());
const createOrganizationLocation = vi.hoisted(() => vi.fn());
const createLocation = vi.hoisted(() => vi.fn());
const createSite = vi.hoisted(() => vi.fn());
const deactivateOrganizationLocation = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const reloadSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/catalog', () => ({
  listOrganizationLocations,
  listCatalogLocations,
  mapLocation,
  createOrganizationLocation,
  createLocation,
  createSite,
  deactivateOrganizationLocation,
}));
vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

let currentSiteScope: string[] = [];
let currentSites: Site[] = [];

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: currentSiteScope,
      recordsFrom: null,
      recordsTo: null,
    },
  };
}

const sites: Site[] = [
  { id: ST_THOMAS, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  { id: GLENCOE, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
];

const newSite: Site = {
  id: NEW_SITE,
  code: 'north-plant',
  name: 'North plant',
  deactivated_at: null,
};

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

/** El alta vive detrás del botón primario, así que todo test que la use lo abre primero. */
async function openAddPanel(): Promise<HTMLInputElement[]> {
  fireEvent.click(await screen.findByRole('button', { name: 'Add location' }));

  return (await screen.findAllByLabelText('Name')) as HTMLInputElement[];
}

function renderRoute(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <LocationsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentSiteScope = [ST_THOMAS, GLENCOE];
  currentSites = [...sites];
  useAppSession.mockReset().mockImplementation(() => ({ ...session('hs_coordinator'), reload: reloadSession }));
  listSites.mockReset().mockImplementation(() => Promise.resolve(currentSites));
  listOrganizationLocations.mockReset().mockResolvedValue(shared);
  listCatalogLocations.mockReset().mockResolvedValue(locations);
  mapLocation.mockReset().mockResolvedValue(locations[0]);
  createOrganizationLocation.mockReset().mockResolvedValue(shared[0]);
  createLocation.mockReset().mockResolvedValue(locations[1]);
  createSite.mockReset().mockResolvedValue(newSite);
  reloadSession.mockReset().mockResolvedValue(undefined);
  deactivateOrganizationLocation.mockReset().mockResolvedValue(undefined);
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
      expect(screen.queryByRole('button', { name: 'Add site' })).toBeNull();
      expect(listCatalogLocations).not.toHaveBeenCalled();
    },
  );
});

describe('la tabla cruza las plantas', () => {
  it('muestra una fila por compartida, con una celda por planta', async () => {
    renderRoute();

    expect(await screen.findByLabelText('Loading dock in St. Thomas')).toBeTruthy();
    expect(screen.getByLabelText('Loading dock in Glencoe')).toBeTruthy();
    expect(screen.getByLabelText('Cold storage in St. Thomas')).toBeTruthy();
  });

  /** El hueco que la versión anterior obligaba a buscar cambiando de planta. */
  it('marca en qué planta falta, sin cambiar de pantalla', async () => {
    renderRoute();

    const cold = await screen.findByLabelText('Cold storage in St. Thomas');

    expect(cold.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByLabelText('Loading dock in St. Thomas').getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('cuenta cuántas faltan en cada columna', async () => {
    renderRoute();

    await screen.findByLabelText('Loading dock in St. Thomas');

    expect(screen.getAllByText('1 of 2').length).toBe(2);
  });

  /**
   * «Dock east» no se llama como la compartida: destildarla suelta ESA fila, y quien lo
   * hace tiene que poder verlo antes.
   */
  it('el tick dice el nombre de la física cuando difiere del de la compartida', async () => {
    renderRoute();

    expect(await screen.findByText('Dock east')).toBeTruthy();
    expect(screen.getByText('Dock west')).toBeTruthy();
  });

  it('la fila lleva el código de la compartida, que es lo que guarda una plantilla', async () => {
    renderRoute();

    expect(await screen.findByText('cold-storage')).toBeTruthy();
  });
});

describe('ordenar por nombre', () => {
  /** Las filas se identifican por el tick de la primera columna, que lleva el nombre. */
  const names = (): string[] =>
    screen
      .getAllByRole('checkbox')
      .map((tick) => tick.getAttribute('aria-label') ?? '')
      .filter((label) => label.endsWith('in Glencoe'))
      .map((label) => label.replace(' in Glencoe', ''));

  it('arranca A→Z', async () => {
    renderRoute();

    await screen.findByLabelText('Loading dock in Glencoe');

    expect(names()).toEqual(['Cold storage', 'Loading dock']);
  });

  it('el encabezado invierte el orden, y vuelve', async () => {
    renderRoute();

    const header = await screen.findByRole('button', { name: /Location/ });

    fireEvent.click(header);
    expect(names()).toEqual(['Loading dock', 'Cold storage']);

    fireEvent.click(header);
    expect(names()).toEqual(['Cold storage', 'Loading dock']);
  });

  /** Sin `aria-sort` el sentido del orden solo lo dice una flecha, que no se lee en voz alta. */
  it('anuncia el sentido del orden', async () => {
    renderRoute();

    const header = await screen.findByRole('columnheader', { name: /Location/ });

    expect(header.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: /Location/ }));

    expect(header.getAttribute('aria-sort')).toBe('descending');
  });

  it('el orden sobrevive a la búsqueda', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /Location/ }));
    fireEvent.change(screen.getByPlaceholderText('Search locations'), {
      target: { value: 'o' },
    });

    expect(names()).toEqual(['Loading dock', 'Cold storage']);
  });
});

describe('buscar y filtrar', () => {
  it('el buscador deja solo lo que coincide, y el conteo lo acompaña', async () => {
    renderRoute();

    fireEvent.change(await screen.findByPlaceholderText('Search locations'), {
      target: { value: 'cold' },
    });

    expect(screen.queryByLabelText('Loading dock in St. Thomas')).toBeNull();
    expect(screen.getByLabelText('Cold storage in St. Thomas')).toBeTruthy();
    expect(screen.getByText('1 of 2 locations')).toBeTruthy();
  });

  it('"Every plant" deja solo las que están en las dos', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Every plant' }));

    expect(screen.getByLabelText('Loading dock in St. Thomas')).toBeTruthy();
    expect(screen.queryByLabelText('Cold storage in St. Thomas')).toBeNull();
  });

  /** «Solo acá» excluye tanto la que falta como la que también está en la otra planta. */
  it('"Glencoe only" excluye la que está en las dos', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Glencoe only' }));

    expect(screen.queryByLabelText('Loading dock in St. Thomas')).toBeNull();
    expect(screen.getByText('No locations match this filter. Try another name, or All.')).toBeTruthy();
  });
});

describe('tildar y destildar', () => {
  /** Sin física libre con ese código: crear y RECIÉN DESPUÉS mapear, que sin id no hay a qué apuntar. */
  it('tildar crea la física en esa planta y la mapea, en ese orden', async () => {
    createLocation.mockResolvedValue({
      id: NEW_COLD_ST,
      site_id: ST_THOMAS,
      code: 'cold-storage',
      name: 'Cold storage',
      deactivated_at: null,
      organization_location_code: null,
    });

    renderRoute();

    fireEvent.click(await screen.findByLabelText('Cold storage in St. Thomas'));

    await waitFor(() => expect(mapLocation).toHaveBeenCalledWith(NEW_COLD_ST, COLD_SHARED));
    expect(createLocation).toHaveBeenCalledWith(ST_THOMAS, {
      code: 'cold-storage',
      name: 'Cold storage',
    });
  });

  /**
   * Destildar no borra la fila (ADR-002), así que volver a tildar tiene que RECUPERARLA: de
   * otro modo se crearía un duplicado que el único `(site_id, code)` rechaza.
   */
  it('tildar reutiliza la huérfana que ya lleva ese código, sin crear otra', async () => {
    listCatalogLocations.mockResolvedValue([
      ...locations,
      {
        id: NEW_COLD_ST,
        site_id: ST_THOMAS,
        code: 'cold-storage',
        name: 'Cold storage',
        deactivated_at: null,
        organization_location_code: null,
      },
    ]);

    renderRoute();

    fireEvent.click(await screen.findByLabelText('Cold storage in St. Thomas'));

    await waitFor(() => expect(mapLocation).toHaveBeenCalledWith(NEW_COLD_ST, COLD_SHARED));
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('destildar suelta el mapeo y no borra nada', async () => {
    renderRoute();

    fireEvent.click(await screen.findByLabelText('Loading dock in St. Thomas'));

    await waitFor(() => expect(mapLocation).toHaveBeenCalledWith(DOCK_ST, null));
    expect(mapLocation).toHaveBeenCalledTimes(1);
    expect(createLocation).not.toHaveBeenCalled();
  });

  /** El error va en la celda que lo causó, no arriba de una lista de veintiuna. */
  it('muestra el error en su propia celda', async () => {
    mapLocation.mockRejectedValue(new Error('This organization location is already mapped'));

    renderRoute();

    fireEvent.click(await screen.findByLabelText('Loading dock in St. Thomas'));

    expect(await screen.findByText(/already mapped/)).toBeTruthy();
  });
});

describe('las físicas que ninguna compartida usa', () => {
  it('se listan por planta, porque ninguna plantilla puede nombrarlas', async () => {
    renderRoute();

    expect(await screen.findByText('Places no shared location uses')).toBeTruthy();
    expect(screen.getByText('spare-room')).toBeTruthy();
  });
});

describe('retirar una ubicación compartida', () => {
  it('abre la confirmación desde la columna de acciones', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Loading dock' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Retire Loading dock?' })).toBeTruthy();
    expect(screen.getByText(/future findings/)).toBeTruthy();
    expect(screen.getByText(/already registered/)).toBeTruthy();
    expect(deactivateOrganizationLocation).not.toHaveBeenCalled();
  });

  it('confirma y llama al endpoint', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Loading dock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire this location' }));

    await waitFor(() =>
      expect(deactivateOrganizationLocation).toHaveBeenCalledWith(DOCK_SHARED),
    );
  });

  it('deja el error dentro del diálogo sin cerrarlo', async () => {
    deactivateOrganizationLocation.mockRejectedValue(new Error('The location was not found'));

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Loading dock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire this location' }));

    expect(await screen.findByText('The location was not found')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Keep it cierra sin llamar al endpoint', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Loading dock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deactivateOrganizationLocation).not.toHaveBeenCalled();
  });
});

describe('dar de alta', () => {
  it('muestra el panel de site y crea la columna nueva', async () => {
    createSite.mockImplementation(async () => {
      currentSites = [...currentSites, newSite];
      currentSiteScope.push(NEW_SITE);
      return newSite;
    });

    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add site' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'North plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(createSite).toHaveBeenCalledWith({ code: 'north-plant', name: 'North plant' }),
    );
    expect(reloadSession).toHaveBeenCalled();
    expect((await screen.findAllByText('North plant')).length).toBeGreaterThan(0);
  });

  it('mantiene independientes los toggles de site y ubicaciones', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Add site' }));
    expect(screen.getByRole('heading', { name: 'Add a site' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add a shared location' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(screen.getByRole('heading', { name: 'Add a site' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a shared location' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect(screen.queryByRole('heading', { name: 'Add a site' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a shared location' })).toBeTruthy();
  });

  it('no vacía el formulario cuando el code de site ya está usado', async () => {
    createSite.mockRejectedValue(new Error('The code "north-plant" is already in use'));

    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add site' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'North plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/already in use/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('North plant');
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('north-plant');
  });

  it('propone el code desde el nombre', async () => {
    renderRoute();

    const names = await openAddPanel();
    fireEvent.change(names[0]!, { target: { value: 'Loading dock' } });

    expect((screen.getAllByLabelText('Code')[0] as HTMLInputElement).value).toBe('loading-dock');
  });

  it('deja de proponerlo en cuanto se lo edita', async () => {
    renderRoute();

    const names = await openAddPanel();
    fireEvent.change(names[0]!, { target: { value: 'Loading' } });

    const code = screen.getAllByLabelText('Code')[0]!;
    fireEvent.change(code, { target: { value: 'chosen-by-hand' } });
    fireEvent.change(names[0]!, { target: { value: 'Loading dock' } });

    expect((code as HTMLInputElement).value).toBe('chosen-by-hand');
  });

  it('crea una ubicación compartida sin planta', async () => {
    renderRoute();

    const names = await openAddPanel();
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

  /**
   * El alta de planta ya no hereda la planta del picker de la página —no hay picker—, así
   * que la elección está en el propio formulario.
   */
  it('el formulario de planta trae su propio selector', async () => {
    renderRoute();
    await openAddPanel();

    expect(screen.getByText('Add a location to one plant')).toBeTruthy();
    expect(screen.getByLabelText('Site')).toBeTruthy();
  });

  it('crea la física en la planta que se elige en el formulario', async () => {
    renderRoute();
    const names = await openAddPanel();

    // Arranca en la primera columna —Glencoe, por orden alfabético—, así que elegir la otra
    // es lo que prueba que el selector hace algo.
    expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe(GLENCOE);

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: ST_THOMAS } });
    fireEvent.change(names[1]!, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!);

    await waitFor(() =>
      expect(createLocation).toHaveBeenCalledWith(ST_THOMAS, {
        code: 'boiler-room',
        name: 'Boiler room',
      }),
    );
  });

  it('no deja crear sin nombre', async () => {
    renderRoute();

    await openAddPanel();

    expect((screen.getAllByRole('button', { name: 'Add' })[0] as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('muestra el rechazo del servidor sin vaciar el formulario', async () => {
    createOrganizationLocation.mockRejectedValue(
      new Error('The code "boiler-room" is already in use'),
    );

    renderRoute();

    const names = await openAddPanel();
    fireEvent.change(names[0]!, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    expect(await screen.findByText(/already in use/)).toBeTruthy();
    expect((screen.getAllByLabelText('Name')[0] as HTMLInputElement).value).toBe('Boiler room');
  });
});
