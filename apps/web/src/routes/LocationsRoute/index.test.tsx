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
const renameSite = vi.hoisted(() => vi.fn());
const deactivateSite = vi.hoisted(() => vi.fn());
const reactivateSite = vi.hoisted(() => vi.fn());
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
  renameSite,
  deactivateSite,
  reactivateSite,
  deactivateOrganizationLocation,
}));
vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

let currentSiteScope: string[] = [];
let currentSites: Site[] = [];
let currentLocations: Location[] = [];

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: currentSiteScope,
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
async function openAddPanel(): Promise<HTMLInputElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Add location' }));

  return (await screen.findByLabelText('Name')) as HTMLInputElement;
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
  currentLocations = [...locations];
  useAppSession.mockReset().mockImplementation(() => ({ ...session('coordinator'), reload: reloadSession }));
  listSites.mockReset().mockImplementation(() => Promise.resolve(currentSites));
  listOrganizationLocations.mockReset().mockResolvedValue(shared);
  listCatalogLocations.mockReset().mockImplementation(() => Promise.resolve(currentLocations));
  mapLocation.mockReset().mockResolvedValue(locations[0]);
  createOrganizationLocation.mockReset().mockResolvedValue(shared[0]);
  createLocation.mockReset().mockResolvedValue(locations[1]);
  createSite.mockReset().mockResolvedValue(newSite);
  renameSite.mockReset().mockImplementation(async (siteId: string, name: string) => {
    const renamed = { ...currentSites.find((site) => site.id === siteId)!, name };
    currentSites = currentSites.map((site) => (site.id === siteId ? renamed : site));
    return renamed;
  });
  deactivateSite.mockReset().mockImplementation(async (siteId: string) => {
    const removed = { ...currentSites.find((site) => site.id === siteId)!, deactivated_at: '2026-08-21T12:00:00.000Z' };
    currentSites = currentSites.map((site) => (site.id === siteId ? removed : site));
    return removed;
  });
  reactivateSite.mockReset().mockImplementation(async (siteId: string) => {
    const restored = { ...currentSites.find((site) => site.id === siteId)!, deactivated_at: null };
    currentSites = currentSites.map((site) => (site.id === siteId ? restored : site));
    return restored;
  });
  reloadSession.mockReset().mockResolvedValue(undefined);
  deactivateOrganizationLocation.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede administrar el catálogo', () => {
  it.each(['inspector'] as const)(
    'se lo niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only coordinators and management can administer locations/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add site' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Manage sites' })).toBeNull();
      expect(listCatalogLocations).not.toHaveBeenCalled();
    },
  );

  it('management puede abrir el catálogo', async () => {
    useAppSession.mockReturnValue(session('management'));
    renderRoute();
    expect(await screen.findByRole('button', { name: 'Add location' })).toBeTruthy();
  });
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

describe('buscar y elegir plantas', () => {
  it('el buscador deja solo lo que coincide, y el conteo lo acompaña', async () => {
    renderRoute();

    fireEvent.change(await screen.findByPlaceholderText('Search locations'), {
      target: { value: 'cold' },
    });

    expect(screen.queryByLabelText('Loading dock in St. Thomas')).toBeNull();
    expect(screen.getByLabelText('Cold storage in St. Thomas')).toBeTruthy();
    expect(screen.getByText('1 of 2 locations')).toBeTruthy();
  });

  /**
   * EL TOGGLE ELIGE COLUMNAS, NO RECORTA FILAS: con Glencoe solo, «Cold storage» —que no está
   * en ninguna planta— tiene que seguir a la vista, porque ese hueco es la pregunta de la
   * pantalla.
   */
  it('una planta prendida deja solo esa columna, con todas las filas', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Glencoe' }));

    expect(screen.queryByLabelText('Loading dock in St. Thomas')).toBeNull();
    expect(screen.getByLabelText('Loading dock in Glencoe')).toBeTruthy();
    expect(screen.getByLabelText('Cold storage in Glencoe')).toBeTruthy();
    expect(screen.getByText('2 of 2 locations')).toBeTruthy();
  });

  it('prender la segunda devuelve las dos columnas', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Glencoe' }));
    fireEvent.click(screen.getByRole('button', { name: 'St. Thomas' }));

    expect(screen.getByLabelText('Loading dock in Glencoe')).toBeTruthy();
    expect(screen.getByLabelText('Loading dock in St. Thomas')).toBeTruthy();
  });

  /** Apagar la última no deja la grilla sin columnas. */
  it('apagar la única prendida vuelve a mostrar todas', async () => {
    renderRoute();

    const glencoe = await screen.findByRole('button', { name: 'Glencoe' });
    fireEvent.click(glencoe);
    fireEvent.click(glencoe);

    expect(glencoe.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Loading dock in St. Thomas')).toBeTruthy();
    expect(screen.getByLabelText('Loading dock in Glencoe')).toBeTruthy();
  });

  it('las huérfanas acompañan a las columnas visibles', async () => {
    renderRoute();

    expect(await screen.findByText('Spare room')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Glencoe' }));

    expect(screen.queryByText('Spare room')).toBeNull();
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

    fireEvent.click(
      await screen.findByRole('button', { name: 'More actions for Loading dock' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire location' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Retire Loading dock?' })).toBeTruthy();
    expect(screen.getByText(/future findings/)).toBeTruthy();
    expect(screen.getByText(/already registered/)).toBeTruthy();
    expect(deactivateOrganizationLocation).not.toHaveBeenCalled();
  });

  it('confirma y llama al endpoint', async () => {
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', { name: 'More actions for Loading dock' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire this location' }));

    await waitFor(() =>
      expect(deactivateOrganizationLocation).toHaveBeenCalledWith(DOCK_SHARED),
    );
  });

  it('deja el error dentro del diálogo sin cerrarlo', async () => {
    deactivateOrganizationLocation.mockRejectedValue(new Error('The location was not found'));

    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', { name: 'More actions for Loading dock' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire this location' }));

    expect(await screen.findByText('The location was not found')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Keep it cierra sin llamar al endpoint', async () => {
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', { name: 'More actions for Loading dock' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire location' }));
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
    expect(screen.queryByRole('heading', { name: 'Add a location' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(screen.getByRole('heading', { name: 'Add a site' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a location' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect(screen.queryByRole('heading', { name: 'Add a site' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a location' })).toBeTruthy();
  });

  /**
   * El alta de planta no pide el código: sale del nombre. La corrección de un code repetido
   * es corregir el nombre, así que el nombre tiene que seguir ahí después del rechazo.
   */
  it('no vacía el formulario cuando el code de site ya está usado', async () => {
    createSite.mockRejectedValue(new Error('The code "north-plant" is already in use'));

    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add site' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'North plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/already in use/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('North plant');
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  /** Un nombre que no produce ningún código no puede salir a viajar: el `CHECK` lo rechaza. */
  it('deja el alta de planta deshabilitada cuando el nombre no produce código', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add site' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '???' } });

    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  /** Lo que se nombra es un lugar; el código es consecuencia del alta, no una decisión. */
  it('no pide el código: lo deriva del nombre', async () => {
    renderRoute();

    const name = await openAddPanel();
    expect(screen.queryByLabelText('Code')).toBeNull();

    fireEvent.change(name, { target: { value: 'Loading dock' } });

    expect(screen.queryByLabelText('Code')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  /** Un nombre que no produce ningún código no puede quedar en un botón gris sin explicación. */
  it('muestra el campo cuando el nombre no produce código', async () => {
    renderRoute();

    const name = await openAddPanel();
    fireEvent.change(name, { target: { value: '???' } });

    expect(screen.getByLabelText('Code')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deja de proponerlo en cuanto se lo edita', async () => {
    createOrganizationLocation.mockRejectedValue(
      new Error('The code "loading" is already in use'),
    );

    renderRoute();

    const name = await openAddPanel();
    fireEvent.change(name, { target: { value: 'Loading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // El campo sale a la luz recién acá, que es cuando hay algo que decidir.
    const code = await screen.findByLabelText('Code');
    expect((code as HTMLInputElement).value).toBe('loading');

    fireEvent.change(code, { target: { value: 'chosen-by-hand' } });
    fireEvent.change(name, { target: { value: 'Loading dock' } });

    expect((code as HTMLInputElement).value).toBe('chosen-by-hand');
  });

  it('crea una ubicación compartida sin planta', async () => {
    renderRoute();

    const name = await openAddPanel();
    fireEvent.change(name, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(createOrganizationLocation).toHaveBeenCalledWith({
        code: 'boiler-room',
        name: 'Boiler room',
      }),
    );
    expect(createLocation).not.toHaveBeenCalled();
  });

  /**
   * El alta de una física en una planta elegida ya no existe: crear el lugar y declarar
   * dónde está son dos actos, y el segundo es el tick de la tabla.
   */
  it('no ofrece un alta por planta', async () => {
    renderRoute();
    await openAddPanel();

    expect(screen.queryByText('Add a location to one plant')).toBeNull();
    expect(screen.queryByLabelText('Site')).toBeNull();
    expect(screen.getAllByLabelText('Name')).toHaveLength(1);
  });

  it('no deja crear sin nombre', async () => {
    renderRoute();

    await openAddPanel();

    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('muestra el rechazo del servidor sin vaciar el formulario', async () => {
    createOrganizationLocation.mockRejectedValue(
      new Error('The code "boiler-room" is already in use'),
    );

    renderRoute();

    const name = await openAddPanel();
    fireEvent.change(name, { target: { value: 'Boiler room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/already in use/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Boiler room');
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('boiler-room');
  });
});

describe('gestionar plantas', () => {
  it('abre la hoja, renombra una planta y conserva su code visible', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage sites' }));
    expect(await screen.findByRole('heading', { name: 'Manage sites' })).toBeTruthy();
    expect(screen.getByText('st-thomas')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit name' })[0]!);
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'St. Thomas Plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(renameSite).toHaveBeenCalledWith(ST_THOMAS, 'St. Thomas Plant'));
    expect(screen.getByText('st-thomas')).toBeTruthy();
  });

  it('mantiene el formulario abierto cuando falla el rename', async () => {
    renameSite.mockRejectedValue(new Error('The site name could not be saved'));

    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage sites' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit name' })[0]!);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The site name could not be saved')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('New name');
  });

  it('confirma Remove y deja la planta retirada fuera de las columnas', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage sites' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    expect(screen.getByText(/can be restored later/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove site' }));

    await waitFor(() => expect(deactivateSite).toHaveBeenCalledWith(GLENCOE));
    expect(screen.getByText('Removed')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Loading dock in Glencoe')).toBeNull());
  });

  it('ofrece Restore para una planta removida y la devuelve con ubicaciones sin mapear', async () => {
    currentSites = [
      sites[0]!,
      { ...sites[1]!, deactivated_at: '2026-08-21T12:00:00.000Z' },
    ];
    currentLocations = locations.map((location) =>
      location.site_id === GLENCOE ? { ...location, organization_location_code: null } : location,
    );

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage sites' }));
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByText(/Restore Glencoe\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore site' }));

    await waitFor(() => expect(reactivateSite).toHaveBeenCalledWith(GLENCOE));
    expect((await screen.findByLabelText('Loading dock in Glencoe')).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('mantiene independientes las tres acciones del encabezado', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage sites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));

    expect(screen.getByRole('heading', { name: 'Manage sites' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a site' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a location' })).toBeTruthy();
  });
});
