import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftIssues, type Session, type TemplateDraft } from '@hs/contracts';

import { TemplateDraftRoute } from './index';

const ST_THOMAS = '11111111-1111-4111-8111-111111111111';
const GLENCOE = '11111111-1111-4111-8111-111111111112';
const WINDSOR = '11111111-1111-4111-8111-111111111113';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';

const getTemplateDraft = vi.hoisted(() => vi.fn());
const saveTemplateDraft = vi.hoisted(() => vi.fn());
const discardTemplateDraft = vi.hoisted(() => vi.fn());
const publishTemplateDraft = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const listOrganizationLocations = vi.hoisted(() => vi.fn());
const listCatalogLocations = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/templates', () => ({
  getTemplateDraft,
  saveTemplateDraft,
  discardTemplateDraft,
  publishTemplateDraft,
}));
vi.mock('../../api/catalog', () => ({ listOrganizationLocations, listCatalogLocations }));
vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/templates">{children}</a>,
  useParams: () => ({ id: DRAFT }),
  useNavigate: () => navigate,
}));

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: [ST_THOMAS, GLENCOE],
    },
  };
}

const SITES = [
  { id: ST_THOMAS, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  { id: GLENCOE, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
];

/** Las compartidas: el concepto, sin planta. Es lo único que una sección guarda. */
const SHARED = [
  { id: '55555555-5555-4555-8555-555555555555', code: 'guarding', name: 'Guarding' },
  { id: '66666666-6666-4666-8666-666666666666', code: 'storage', name: 'Storage' },
  { id: '77777777-7777-4777-8777-777777777777', code: 'machines', name: 'Machines' },
];

/**
 * Las físicas, una por planta. `guarding` y `storage` están tickeadas en las dos plantas;
 * `machines` SOLO en St. Thomas, que es el caso que el recorte tiene que atrapar.
 */
const PHYSICAL = [
  physical('p1', ST_THOMAS, 'guarding', 'Guarding line'),
  physical('p2', GLENCOE, 'guarding', 'Guarding bay'),
  physical('p3', ST_THOMAS, 'storage', 'Storage room'),
  physical('p4', GLENCOE, 'storage', 'Storage shed'),
  physical('p5', ST_THOMAS, 'machines', 'Machine shop'),
];

function physical(id: string, siteId: string, code: string, name: string) {
  return {
    id,
    site_id: siteId,
    code: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    deactivated_at: null,
    organization_location_code: code,
  };
}

/** Un borrador con una sección y una pregunta: publicable, para que los issues sean señal. */
function draft(overrides: Partial<TemplateDraft> = {}): TemplateDraft {
  const document = overrides.document ?? {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Guarding',
        organization_location_code: 'guarding',
        items: [
          {
            item_key: 'guard.fitted',
            prompt: 'Is the guard fitted?',
            required: true,
            response_type: 'yes_no' as const,
            fails_on: 'no' as const,
          },
        ],
      },
    ],
  };

  return {
    id: DRAFT,
    key: 'monthly-electrical',
    name: 'Monthly electrical inspection',
    updated_at: '2026-08-14T10:00:00.000Z',
    site_ids: [ST_THOMAS, GLENCOE],
    template_id: null,
    next_version: 1,
    document,
    issues: draftIssues(document),
    publishable: draftIssues(document).length === 0,
    ...overrides,
  };
}

function renderRoute(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <TemplateDraftRoute />
    </QueryClientProvider>,
  );
}

/** Espera a que el editor esté montado con el borrador cargado. */
async function ready(): Promise<void> {
  await screen.findByLabelText('Template name');
  // El alcance depende de `listSites`, que llega en su propia consulta: sin esperarla, el
  // selector todavía no existe y las aserciones sobre el recorte miran una pantalla a medio
  // resolver.
  await screen.findByRole('button', { name: /^St\. Thomas$/ });
}

/** Abre el menú «⋮» que se llama `name` y devuelve su contenedor. */
async function openMenu(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name }));

  return screen.getByRole('menu');
}

/** Cierra el sheet abierto como lo hace Escape y espera a que termine la transición. */
async function closeSheet(): Promise<void> {
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** El cuerpo del último `saveTemplateDraft`. */
function lastSave(): {
  name: string;
  document: unknown;
  site_ids: string[];
} {
  const call = saveTemplateDraft.mock.calls.at(-1);

  if (!call) throw new Error('No se llamó a saveTemplateDraft.');

  return call[1];
}

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session('coordinator'));
  getTemplateDraft.mockReset().mockResolvedValue(draft());
  listOrganizationLocations.mockReset().mockResolvedValue(SHARED);
  listCatalogLocations.mockReset().mockResolvedValue(PHYSICAL);
  listSites.mockReset().mockResolvedValue(SITES);
  discardTemplateDraft.mockReset().mockResolvedValue(undefined);
  publishTemplateDraft.mockReset().mockResolvedValue({
    template_id: '88888888-8888-4888-8888-888888888888',
    template_version_id: '99999999-9999-4999-8999-999999999999',
    version: 1,
  });
  navigate.mockReset();
  saveTemplateDraft
    .mockReset()
    .mockImplementation(
      async (_id: string, body: { name: string; document: never; site_ids: string[] }) =>
        draft({ ...body }),
    );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede escribir plantillas', () => {
  it.each(['inspector'] as const)(
    'se lo niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only coordinators and management can write templates/)).toBeTruthy();
      expect(getTemplateDraft).not.toHaveBeenCalled();
    },
  );

  it('management puede abrir el editor', async () => {
    useAppSession.mockReturnValue(session('management'));
    renderRoute();
    await ready();
    expect(screen.getByLabelText('Template name')).toBeTruthy();
  });
});

describe('escribir la plantilla', () => {
  it('agrega una sección y una pregunta', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));

    const sections = screen.getAllByLabelText('Location');
    expect(sections).toHaveLength(2);

    fireEvent.change(sections[1]!, { target: { value: 'storage' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add question' })[1]!);

    expect(screen.getAllByRole('textbox', { name: /^Question / })).toHaveLength(2);
  }, 15_000);

  it('no muestra claves técnicas de secciones ni preguntas', async () => {
    renderRoute();
    await ready();

    expect(screen.queryByLabelText('Key')).toBeNull();
  });

  it('quita una pregunta desde su menú', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More actions for Is the guard fitted?');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove question' }));

    expect(screen.queryByRole('textbox', { name: /^Question / })).toBeNull();
  });
});

describe('el alcance de plantas', () => {
  it('ofrece un toggle por planta sin combinaciones fijas', async () => {
    renderRoute();
    await ready();

    expect(screen.getByRole('button', { name: /^St\. Thomas$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Glencoe$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Both plants/ })).toBeNull();
  });

  it('marca cada planta que el borrador ya tiene', async () => {
    renderRoute();
    await ready();

    expect(
      screen.getByRole('button', { name: /^St\. Thomas$/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: /^Glencoe$/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('viaja en el guardado', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());

    expect(lastSave().site_ids).toEqual([ST_THOMAS]);
  });

  it('cambiarlo cuenta como un cambio sin guardar', async () => {
    renderRoute();
    await ready();

    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
  });

  it('no permite apagar la última planta elegida', async () => {
    getTemplateDraft.mockResolvedValue(draft({ site_ids: [ST_THOMAS] }));

    renderRoute();
    await ready();

    const stThomas = screen.getByRole('button', {
      name: /^St\. Thomas$/,
    }) as HTMLButtonElement;
    expect(stThomas.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));

    expect(stThomas.disabled).toBe(false);
    fireEvent.click(stThomas);
    expect((screen.getByRole('button', { name: /^Glencoe$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('agrega automáticamente un toggle para una planta nueva', async () => {
    useAppSession.mockReturnValue({
      account: { ...session('coordinator').account, siteScope: [ST_THOMAS, GLENCOE, WINDSOR] },
    });
    listSites.mockResolvedValue([
      ...SITES,
      { id: WINDSOR, code: 'windsor', name: 'Windsor', deactivated_at: null },
    ]);

    renderRoute();
    await ready();

    const windsor = screen.getByRole('button', { name: /^Windsor$/ });
    expect(windsor.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(windsor);

    expect(windsor.getAttribute('aria-pressed')).toBe('true');
  });

  /** Con una sola planta administrada no hay nada que elegir. */
  it('no se dibuja cuando la cuenta administra una sola planta', async () => {
    useAppSession.mockReturnValue({
      account: { ...session('coordinator').account, siteScope: [ST_THOMAS] },
    });
    getTemplateDraft.mockResolvedValue(draft({ site_ids: [ST_THOMAS] }));

    renderRoute();
    await screen.findByLabelText('Template name');

    expect(screen.queryByText('Template scope')).toBeNull();
  });
});

describe('las ubicaciones que una sección puede nombrar', () => {
  const codes = (): string[] =>
    [...(screen.getAllByLabelText('Location')[0] as HTMLSelectElement).options]
      .map((option) => option.value)
      .filter(Boolean);

  it('con las dos plantas solo ofrece las mapeadas en las dos', async () => {
    renderRoute();
    await ready();

    expect(codes()).toEqual(['guarding', 'storage']);
  });

  it('al achicar el alcance aparece la que solo esa planta tiene', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));

    expect(codes()).toEqual(['guarding', 'storage', 'machines']);
  });

  /**
   * Recortar la oferta NO puede convertirse en una edición: el valor guardado sigue en el
   * `<select>` aunque el alcance nuevo lo dejaría afuera.
   */
  it('conserva la ubicación ya elegida aunque el alcance la deje afuera, y lo avisa', async () => {
    getTemplateDraft.mockResolvedValue(
      draft({
        site_ids: [ST_THOMAS],
        document: {
          sections: [
            {
              section_key: 'machines',
              section_title: 'Machines',
              organization_location_code: 'machines',
              items: [
                {
                  item_key: 'guard.fitted',
                  prompt: 'Is the guard fitted?',
                  required: true,
                  response_type: 'yes_no' as const,
                  fails_on: 'no' as const,
                },
              ],
            },
          ],
        },
      }),
    );

    renderRoute();
    await screen.findByLabelText('Template name');
    await screen.findByRole('button', { name: /^St\. Thomas$/ });

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));

    expect((screen.getAllByLabelText('Location')[0] as HTMLSelectElement).value).toBe('machines');
    expect(screen.getByText(/not mapped at every plant in scope/)).toBeTruthy();
  });

  it('muestra a qué lugar físico resuelve en cada planta, sin ofrecerlo como campo', async () => {
    renderRoute();
    await ready();

    expect(screen.getByText('Guarding line')).toBeTruthy();
    expect(screen.getByText('Guarding bay')).toBeTruthy();
    expect(screen.queryByLabelText('St. Thomas location')).toBeNull();
  });

  it('dibuja el hueco de la planta que no tiene esa ubicación', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));
    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'machines' } });
    fireEvent.click(screen.getByRole('button', { name: /^Glencoe$/ }));

    expect(screen.getByText('Not mapped here')).toBeTruthy();
  });
});

describe('reordenar', () => {
  async function twoSections(): Promise<void> {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getAllByLabelText('Location')[1]!, { target: { value: 'storage' } });
  }

  /** El menú es el camino de teclado de ADR-010; el arrastre es el atajo, no la garantía. */
  it('sube una sección desde el menú', async () => {
    await twoSections();

    const menu = await openMenu('More actions for section Storage');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move up' }));

    const codes = (screen.getAllByLabelText('Location') as HTMLSelectElement[]).map(
      (input) => input.value,
    );
    expect(codes).toEqual(['storage', 'guarding']);
  });

  it('los movimientos de los extremos están deshabilitados, no ausentes', async () => {
    await twoSections();

    const menu = await openMenu('More actions for section Guarding');

    expect(
      (within(menu).getByRole('menuitem', { name: 'Move up' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(menu).getByRole('menuitem', { name: 'Move down' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('sube una pregunta dentro de su sección', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.change(screen.getAllByRole('textbox', { name: /^Question / })[1]!, {
      target: { value: 'Is the exit clear?' },
    });

    const menu = await openMenu('More actions for Is the exit clear?');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move up' }));

    const prompts = (
      screen.getAllByRole('textbox', { name: /^Question / }) as HTMLInputElement[]
    ).map((input) => input.value);
    expect(prompts).toEqual(['Is the exit clear?', 'Is the guard fitted?']);
  });
});

describe('duplicar', () => {
  it('una pregunta queda justo debajo, con el mismo texto', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More actions for Is the guard fitted?');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate question' }));

    const prompts = (
      screen.getAllByRole('textbox', { name: /^Question / }) as HTMLInputElement[]
    ).map((input) => input.value);
    expect(prompts).toEqual(['Is the guard fitted?', 'Is the guard fitted?']);
  });

  it('una sección se copia entera y el documento no gana ningún problema', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More actions for section Guarding');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate section' }));

    expect(screen.getAllByLabelText('Location')).toHaveLength(2);
    expect(screen.getByText(/Nothing left to fill in/)).toBeTruthy();
  });

  it('elimina una sección desde su menú', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More actions for section Guarding');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove section' }));

    expect(screen.queryByLabelText('Location')).toBeNull();
    expect(screen.getByText('Your flow is empty')).toBeTruthy();
  });
});

describe('la configuración del tipo de respuesta', () => {
  it('la configuración no se ve en la fila y el engranaje la abre en el sheet', async () => {
    getTemplateDraft.mockResolvedValue(
      draft({
        document: {
          sections: [
            {
              section_key: 'guarding',
              section_title: 'Guarding',
              organization_location_code: 'guarding',
              items: [
                {
                  item_key: 'guard.choice',
                  prompt: 'Which guard is fitted?',
                  required: true,
                  response_type: 'single_choice' as const,
                  options: [
                    { label: 'Fixed', value: 'fixed' },
                    { label: 'Removable', value: 'removable' },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    renderRoute();
    await ready();

    expect(screen.queryByText('Answer settings')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Answer settings')).toBeTruthy();
    expect((within(dialog).getAllByLabelText('Label')[0] as HTMLInputElement).value).toBe('Fixed');
    expect(screen.getByLabelText('Question 1')).toBeTruthy();
  });

  it('cambiar de tipo reemplaza los campos de configuración', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'text' } });
    expect(within(screen.getByRole('dialog')).getByLabelText('Maximum length')).toBeTruthy();

    await closeSheet();

    fireEvent.change(screen.getByLabelText('Answer type'), {
      target: { value: 'single_choice' },
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Maximum length')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add option' })).toBeTruthy();
  });

  /**
   * El renglón compacto del mockup esconde la configuración, así que el sheet tiene que
   * abrirse solo al elegir un tipo que la necesita: descubrirlo en la lista de pendientes
   * mandaría al autor a buscar dónde se configura.
   */
  it('abre el sheet solo al elegir un tipo que la necesita', async () => {
    renderRoute();
    await ready();

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'number' } });

    expect(within(screen.getByRole('dialog')).getByLabelText('Decimal places')).toBeTruthy();
  });

  it('un tipo sin configuración no abre el sheet ni muestra ningún campo de más', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'signature' } });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Decimal places')).toBeNull();
    expect(screen.queryByLabelText('Minimum')).toBeNull();
  });

  it('en un tipo sin configuración el engranaje abre el sheet solo con la acción', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'signature' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByText('Answer settings')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add corrective action' })).toBeTruthy();
  });

  it('las opciones se escriben con etiqueta y valor por separado', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answer type'), {
      target: { value: 'single_choice' },
    });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add option' }));

    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Fitted' } });
    fireEvent.change(within(dialog).getByLabelText('Stored value'), {
      target: { value: 'fitted' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());

    expect(JSON.stringify(lastSave().document)).toContain('"value":"fitted"');
  });

  it('cerrar el sheet descarta lo que se tocó adentro', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Fails when answered'), {
      target: { value: 'yes' },
    });

    await closeSheet();

    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});

describe('la prescripción de un hallazgo', () => {
  it('abre el sheet, muestra la pregunta y guarda la acción como cambio local', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText('Is the guard fitted?')).toBeTruthy();
    expect(within(dialog).getByText('Yes / No')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add corrective action' }));
    fireEvent.change(within(dialog).getByLabelText('Corrective action'), {
      target: { value: 'Refit the machine guard before use.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
  });

  it('cancela con Escape sin ensuciar el borrador', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add corrective action' }),
    );
    await closeSheet();

    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });

  it('se puede guardar la configuración sin agregar una acción', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByLabelText('Corrective action')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add corrective action' })).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Fails when answered'), {
      target: { value: 'yes' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());

    const saved = JSON.stringify(lastSave().document);
    expect(saved).toContain('"fails_on":"yes"');
    expect(saved).not.toContain('"finding"');
  });

  it('muestra el umbral en number y no en yes_no', async () => {
    renderRoute();
    await ready();

    expect(screen.queryByLabelText('Operator')).toBeNull();
    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'number' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add corrective action' }));

    expect(within(dialog).getByLabelText('Operator')).toBeTruthy();
    expect(within(dialog).getByLabelText('Threshold value')).toBeTruthy();
    expect(within(dialog).getByText(/does not create a finding yet/)).toBeTruthy();
  });

  it('en yes_no muestra cuándo falla y guarda el cambio junto con la acción', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    const dialog = screen.getByRole('dialog');
    const failsOn = within(dialog).getByLabelText('Fails when answered') as HTMLSelectElement;

    expect(failsOn.value).toBe('no');

    fireEvent.change(failsOn, { target: { value: 'yes' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add corrective action' }));
    fireEvent.change(within(dialog).getByLabelText('Corrective action'), {
      target: { value: 'Refit the machine guard before use.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());

    const saved = JSON.stringify(lastSave().document);
    expect(saved).toContain('"fails_on":"yes"');
    expect(saved).toContain('"corrective_action":"Refit the machine guard before use."');
  });

  it('en un tipo sin semántica de falla avisa que la acción no se dispara sola', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'text' } });
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText(/never creates a finding on its own/)).toBeTruthy();
    expect(within(dialog).queryByLabelText('Fails when answered')).toBeNull();
    expect(within(dialog).queryByLabelText('Operator')).toBeNull();
  });
});

describe('lo que falta para publicar', () => {
  it('se muestra siempre y no bloquea el guardado', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));

    expect(screen.getByText(/has no items/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('dice que no falta nada cuando el documento está completo', async () => {
    renderRoute();
    await ready();

    expect(screen.getByText(/Nothing left to fill in/)).toBeTruthy();
  });

  it('se actualiza mientras se escribe', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByRole('textbox', { name: /^Question / }), {
      target: { value: '' },
    });

    expect(screen.getByText(/has no question text/)).toBeTruthy();
  });
});

describe('el panel de resumen', () => {
  it('cuenta secciones, preguntas y ubicaciones enlazadas', async () => {
    renderRoute();
    await ready();

    const summary = screen.getByText('Template summary').closest('section') as HTMLElement;

    expect(within(summary).getByText('Sections').nextElementSibling?.textContent).toBe('1');
    expect(within(summary).getByText('Questions').nextElementSibling?.textContent).toBe('1');
    expect(within(summary).getByText('Locations linked').nextElementSibling?.textContent).toBe('1');
  });

  it('desglosa cada sección con el lugar de cada planta', async () => {
    renderRoute();
    await ready();

    const summary = screen.getByText('Template summary').closest('section') as HTMLElement;

    expect(within(summary).getByText('St. Thomas: Guarding line')).toBeTruthy();
    expect(within(summary).getByText('Glencoe: Guarding bay')).toBeTruthy();
  });

  it('sigue el alcance elegido', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /^St\. Thomas$/ }));

    const summary = screen.getByText('Template summary').closest('section') as HTMLElement;

    // El alcance de la plantilla, no el de la sección: los dos dicen «Glencoe only» ahora
    // mismo, y buscar el texto suelto no distinguiría cuál de los dos siguió al selector.
    expect(within(summary).getByText('Scope').nextElementSibling?.textContent).toContain(
      'Glencoe only',
    );
  });
});

describe('guardar', () => {
  it('manda el documento completo', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalledWith(DRAFT, expect.anything()));

    const body = lastSave();
    expect(JSON.stringify(body.document)).toContain('"section_title":"Storage"');
  });

  it('guarda el título escrito y lo conserva al cambiar la ubicación', async () => {
    renderRoute();
    await ready();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Section title for section Guarding' }),
      { target: { value: 'Docks and aisles' } },
    );
    fireEvent.change(screen.getAllByLabelText('Location')[0]!, {
      target: { value: 'storage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalledWith(DRAFT, expect.anything()));

    expect(lastSave().document).toMatchObject({
      sections: [
        expect.objectContaining({
          organization_location_code: 'storage',
          section_title: 'Docks and aisles',
        }),
      ],
    });
  });

  it('el botón dice "Saved" mientras no haya cambios', async () => {
    renderRoute();
    await ready();

    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  /** No hay autosave: el encabezado confirma el último guardado explícito. */
  it('después de guardar dice Saved y no anuncia ningún autoguardado', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await screen.findByRole('button', { name: 'Saved' });

    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    expect(screen.queryByText(/Auto-saved/)).toBeNull();
  });

  it('un error de guardado se avisa y no pierde lo editado', async () => {
    saveTemplateDraft.mockRejectedValue(
      new Error('The draft could not be saved.'),
    );

    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/could not be saved/)).toBeTruthy();
    expect(screen.getByText(/Nothing you typed has been lost/)).toBeTruthy();
    expect((screen.getAllByLabelText('Location')[0] as HTMLSelectElement).value).toBe('storage');
  });

  it('sin conexión no monta el editor sobre un documento que no llegó', async () => {
    getTemplateDraft.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('offline')).toBeTruthy();
    expect(screen.queryByLabelText('Template name')).toBeNull();
  });
});

describe('publicar', () => {
  it('mantiene el botón deshabilitado si hay issues', async () => {
    getTemplateDraft.mockResolvedValue(
      draft({
        document: {
          sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [] }],
        },
      }),
    );

    renderRoute();
    await screen.findByLabelText('Template name');

    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(publishTemplateDraft).not.toHaveBeenCalled();
  });

  it('mantiene el botón deshabilitado con cambios sin guardar', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'storage' } });

    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('pide confirmación antes de publicar', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByText('Publish “Monthly electrical inspection”?')).toBeTruthy();
    expect(screen.getByText(/cannot be edited/)).toBeTruthy();
    expect(publishTemplateDraft).not.toHaveBeenCalled();
  });

  it('publica, invalida el catálogo y vuelve al listado', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish template' }));

    await waitFor(() => expect(publishTemplateDraft).toHaveBeenCalledWith(DRAFT));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/templates' }));
  });
});

describe('la cabecera', () => {
  /**
   * Se MUESTRA pero no se edita. El autor no la eligió —la derivó el servidor del nombre— y
   * renombrar no la mueve, así que un borrador renombrado queda con una clave que ya no se
   * le parece; esconderla del todo dejaría eso sin explicación el día que alguien lea un
   * seed.
   */
  it('muestra la clave de solo lectura, sin ofrecerla como campo', async () => {
    renderRoute();
    await ready();

    expect(screen.getByText('monthly-electrical')).toBeTruthy();
    expect(screen.queryByLabelText('Key')).toBeNull();
  });

  it('dice que crea la versión 1 cuando el borrador no corrige nada', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByText(/This creates version 1\./)).toBeTruthy();
  });

  it('descarta el borrador desde el menú', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More template actions');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Discard this draft' }));

    await waitFor(() => expect(discardTemplateDraft).toHaveBeenCalledWith(DRAFT));
  });
});

/**
 * El mismo editor escribe una plantilla nueva y corrige una publicada. Lo que las distingue
 * —qué se corrige, qué número va a tener la versión, y que el nombre ya está decidido— tiene
 * que verse sin abrir la base: el autor que cree estar empezando de cero toma otras decisiones
 * sobre el mismo documento.
 */
describe('cuando el borrador revisa una plantilla publicada', () => {
  const TEMPLATE = '55555555-5555-4555-8555-555555555555';

  function revision(): TemplateDraft {
    return draft({ template_id: TEMPLATE, next_version: 3 });
  }

  beforeEach(() => {
    getTemplateDraft.mockResolvedValue(revision());
  });

  it('lo dice en la cabecera, con la plantilla y el número de versión', async () => {
    renderRoute();
    await ready();

    expect(screen.getByRole('heading', { name: 'Revise template' })).toBeTruthy();
    expect(screen.getByText(/Correcting “Monthly electrical inspection”/)).toBeTruthy();
    expect(screen.getByText(/Publishing writes version 3/)).toBeTruthy();
    expect(screen.getByText('Revision · version 3')).toBeTruthy();
  });

  it('no ofrece el nombre para editar y explica por qué', async () => {
    renderRoute();
    await ready();

    const name = screen.getByLabelText('Template name') as HTMLInputElement;

    expect(name.readOnly).toBe(true);
    expect(
      screen.getByText(/The name of a published template cannot be changed by revising it/),
    ).toBeTruthy();
  });

  it('la confirmación nombra la versión que va a escribir, no la 1', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByText(/This creates version 3\./)).toBeTruthy();
    expect(screen.getByText(/The version it replaces stays readable/)).toBeTruthy();
  });

  it('el documento sembrado se sigue editando y guardando como cualquier otro', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByDisplayValue('Is the guard fitted?'), {
      target: { value: 'Is the machine guard fitted and secured?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());
    expect(lastSave().name).toBe('Monthly electrical inspection');
  });

  it('el menú habla de descartar la revisión, no el borrador', async () => {
    renderRoute();
    await ready();

    const menu = await openMenu('More template actions');

    expect(within(menu).getByRole('menuitem', { name: 'Discard this revision' })).toBeTruthy();
  });
});
