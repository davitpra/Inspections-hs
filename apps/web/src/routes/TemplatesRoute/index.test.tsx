import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedTemplateSummary, Session, TemplateDraftSummary } from '@hs/contracts';

import { TemplatesRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const OTHER_DRAFT = '55555555-5555-4555-8555-555555555555';

const listTemplateDrafts = vi.hoisted(() => vi.fn());
const listPublishedTemplates = vi.hoisted(() => vi.fn());
const createTemplateDraft = vi.hoisted(() => vi.fn());
const discardTemplateDraft = vi.hoisted(() => vi.fn());
const publishTemplateDraft = vi.hoisted(() => vi.fn());
const reviseTemplate = vi.hoisted(() => vi.fn());
const deactivateTemplate = vi.hoisted(() => vi.fn());
const reactivateTemplate = vi.hoisted(() => vi.fn());
const archiveTemplate = vi.hoisted(() => vi.fn());
const restoreTemplate = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/templates', () => ({
  listTemplateDrafts,
  listPublishedTemplates,
  createTemplateDraft,
  discardTemplateDraft,
  publishTemplateDraft,
  reviseTemplate,
  deactivateTemplate,
  reactivateTemplate,
  archiveTemplate,
  restoreTemplate,
}));

vi.mock('../../app/session-context', () => ({ useAppSession }));

/**
 * El router no se monta: se renderiza el componente de ruta directo, como el resto de los
 * tests de ruta. `Link` y `useNavigate` se reemplazan por lo mínimo que la pantalla usa.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    // `href` de verdad: sin él, `getAllByRole('link')` no encuentra nada y el orden de la
    // lista dejaría de ser comprobable. `to`/`params` se recortan para no llegar al DOM.
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: [SITE],
    },
  };
}

function draft(overrides: Partial<TemplateDraftSummary> = {}): TemplateDraftSummary {
  return {
    id: DRAFT,
    key: 'monthly-electrical',
    name: 'Monthly electrical inspection',
    updated_at: '2026-08-14T10:00:00.000Z',
    publishable: false,
    site_ids: [SITE],
    template_id: null,
    next_version: 1,
    ...overrides,
  };
}

function published(
  overrides: Partial<PublishedTemplateSummary> = {},
): PublishedTemplateSummary {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    key: 'published-electrical',
    name: 'Published electrical inspection',
    latest_version: 1,
    latest_version_id: '77777777-7777-4777-8777-777777777777',
    latest_published_at: '2026-08-22 10:00:00+00',
    deactivated_at: null,
    archived_at: null,
    ...overrides,
  };
}

function renderRoute(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <TemplatesRoute />
    </QueryClientProvider>,
  );

  return queryClient;
}

/**
 * Abrir el «⋮» de una fila de borrador, que es por donde se llega a todo lo que la fila
 * ofrece. Devuelve el menú desplegado para poder buscar adentro: el de la fila publicada
 * tiene sus propias entradas y el `getByRole('menuitem')` suelto las confundiría.
 */
async function openDraftMenu(name = 'Monthly electrical inspection'): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));

  return screen.getByRole('menu');
}

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
  listTemplateDrafts.mockReset().mockResolvedValue([draft()]);
  listPublishedTemplates.mockReset().mockResolvedValue([]);
  createTemplateDraft.mockReset().mockResolvedValue({
    ...draft({ id: OTHER_DRAFT }),
    document: { sections: [] },
    issues: [],
  });
  discardTemplateDraft.mockReset().mockResolvedValue(undefined);
  publishTemplateDraft.mockReset().mockResolvedValue({
    ...published(),
    document: { sections: [] },
  });
  reviseTemplate.mockReset().mockResolvedValue({
    ...draft({ id: OTHER_DRAFT, template_id: published().id, next_version: 2 }),
    document: { sections: [] },
    issues: [],
  });
  deactivateTemplate.mockReset().mockResolvedValue(undefined);
  reactivateTemplate.mockReset().mockResolvedValue(undefined);
  archiveTemplate.mockReset().mockResolvedValue(undefined);
  restoreTemplate.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede escribir plantillas', () => {
  it.each(['hs_coordinator', 'management'] as const)('se la ofrece a %s', async (role) => {
    useAppSession.mockReturnValue(session(role));
    renderRoute();

    expect(await screen.findByText('Monthly electrical inspection')).toBeTruthy();
  });

  /**
   * Y sin disparar la consulta: pedir algo que el servidor va a negar con 403 solo sirve
   * para llenar el log. Es lo mismo que hace `RosterRoute`.
   */
  it.each(['jhsc_member'] as const)(
    'se la niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only H&S coordinators and management can write templates/)).toBeTruthy();
      expect(listTemplateDrafts).not.toHaveBeenCalled();
    },
  );
});

describe('el listado', () => {
  it('dice que un borrador se sigue editando hasta publicarlo', async () => {
    renderRoute();

    await screen.findByText('Monthly electrical inspection');

    expect(screen.getByText(/can continue to be edited/)).toBeTruthy();
  });

  /**
   * Las cabeceras, porque el listado es una tabla y no una lista de renglones: la fecha
   * es una columna propia justamente para poder comparar entre filas.
   */
  it('tabula los borradores con las mismas columnas que las publicadas', async () => {
    renderRoute();

    const table = await screen.findByRole('table', { name: 'Your drafts' });

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Details', 'Last saved', 'Status', 'Actions']);
  });

  it('muestra la clave y el estado de cada borrador', async () => {
    listTemplateDrafts.mockResolvedValue([
      draft(),
      draft({ id: OTHER_DRAFT, key: 'monthly-fire', name: 'Fire', publishable: true }),
    ]);

    renderRoute();

    await screen.findByText('Fire');

    expect(screen.getByText(/monthly-electrical/)).toBeTruthy();
    expect(screen.getByText('Not ready yet')).toBeTruthy();
    expect(screen.getByText('Ready to publish')).toBeTruthy();
  });

  it('el más trabajado va primero', async () => {
    listTemplateDrafts.mockResolvedValue([
      draft({ updated_at: '2026-08-01T00:00:00.000Z' }),
      draft({ id: OTHER_DRAFT, name: 'Newer', updated_at: '2026-08-20T00:00:00.000Z' }),
    ]);

    renderRoute();

    await screen.findByText('Newer');

    const links = screen.getAllByRole('link');
    expect(links[0]?.textContent).toBe('Newer');
  });

  it('invita a empezar cuando no hay ninguno', async () => {
    listTemplateDrafts.mockResolvedValue([]);

    renderRoute();

    expect(await screen.findByText('No drafts yet')).toBeTruthy();
    expect(screen.getByText(/Select Add Template above/)).toBeTruthy();
  });

  it('sin conexión lo dice en vez de mostrar una lista vacía', async () => {
    listTemplateDrafts.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/This view needs a connection/)).toBeTruthy();
  });
});

describe('las plantillas publicadas', () => {
  it('muestra una publicada y no mezcla el borrador en ese bloque', async () => {
    listPublishedTemplates.mockResolvedValue([published()]);

    renderRoute();

    await screen.findByText('Published electrical inspection');
    const publishedBlock = screen
      .getByRole('heading', { name: 'Published templates' })
      .closest('section');

    expect(publishedBlock).toBeTruthy();
    expect(within(publishedBlock!).getByText('Published electrical inspection')).toBeTruthy();
    expect(within(publishedBlock!).getByText(/Version 1/)).toBeTruthy();
    expect(within(publishedBlock!).getByText('2026-08-22')).toBeTruthy();
    expect(within(publishedBlock!).getByRole('columnheader', { name: 'Name' })).toBeTruthy();
    expect(within(publishedBlock!).getByRole('columnheader', { name: 'Version' })).toBeTruthy();
    expect(within(publishedBlock!).getByRole('columnheader', { name: 'Published' })).toBeTruthy();
    expect(within(publishedBlock!).getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    expect(within(publishedBlock!).getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
    expect(within(publishedBlock!).getByText('Active')).toBeTruthy();
    expect(
      within(publishedBlock!).getByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    ).toBeTruthy();
    expect(within(publishedBlock!).queryByText('Monthly electrical inspection')).toBeNull();
  });

  it('oculta una archivada hasta pedir verlas', async () => {
    const archived = published({
      id: '88888888-8888-4888-8888-888888888888',
      name: 'Archived electrical inspection',
      deactivated_at: '2026-08-23T10:00:00.000Z',
      archived_at: '2026-08-24T10:00:00.000Z',
    });
    listPublishedTemplates.mockResolvedValue([published(), archived]);

    renderRoute();

    await screen.findByText('Published electrical inspection');
    expect(screen.queryByText('Archived electrical inspection')).toBeNull();

    fireEvent.click(await screen.findByLabelText('Show archived'));

    expect(await screen.findByText('Archived electrical inspection')).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('abre una revisión editable sin modificar la versión publicada', async () => {
    listPublishedTemplates.mockResolvedValue([published()]);
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit template' }));

    await waitFor(() => expect(reviseTemplate).toHaveBeenCalledWith(published().id));
    expect(navigate).toHaveBeenCalledWith({
      to: '/templates/drafts/$id',
      params: { id: OTHER_DRAFT },
    });
  });

  /**
   * Retirar es una decisión de catálogo y se confirma. Lo que la confirmación tiene que
   * decir es lo que NO pasa: lo ya programado no se toca.
   */
  it('retira una plantilla después de confirmar', async () => {
    listPublishedTemplates.mockResolvedValue([published()]);
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate template' }));

    const dialog = screen.getByRole('dialog', { name: 'Deactivate template' });

    expect(within(dialog).getByText(/stops being offered when scheduling/)).toBeTruthy();
    expect(deactivateTemplate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate template' }));

    await waitFor(() => expect(deactivateTemplate).toHaveBeenCalledWith(published().id));
  });

  it('archiva una retirada después de confirmar', async () => {
    const retired = published({ deactivated_at: '2026-08-23T10:00:00.000Z' });
    listPublishedTemplates.mockResolvedValue([retired]);
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive template' }));

    const dialog = screen.getByRole('dialog', { name: 'Archive template' });
    expect(within(dialog).getByText(/published versions, requirements and inspections/)).toBeTruthy();
    expect(archiveTemplate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive template' }));

    await waitFor(() => expect(archiveTemplate).toHaveBeenCalledWith(retired.id));
  });

  it('deja salir del diálogo sin retirar nada', async () => {
    listPublishedTemplates.mockResolvedValue([published()]);
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep active' }));

    expect(screen.queryByRole('dialog', { name: 'Deactivate template' })).toBeNull();
    expect(deactivateTemplate).not.toHaveBeenCalled();
  });

  /**
   * Una retirada sigue en la tabla —si desapareciera no habría forma de reactivarla— y no
   * ofrece "Edit template": el servidor rechaza revisar una plantilla dada de baja, así que
   * ofrecerlo sería ofrecer un error.
   */
  it('muestra la retirada como Deactivated y solo ofrece reactivarla', async () => {
    listPublishedTemplates.mockResolvedValue([
      published({ deactivated_at: '2026-08-23T10:00:00.000Z' }),
    ]);
    renderRoute();

    expect(await screen.findByText('Deactivated')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );

    expect(screen.queryByRole('menuitem', { name: 'Edit template' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivate template' }));

    await waitFor(() => expect(reactivateTemplate).toHaveBeenCalledWith(published().id));
    expect(screen.queryByRole('dialog', { name: 'Deactivate template' })).toBeNull();
  });

  it('restaura una archivada como única acción', async () => {
    listPublishedTemplates.mockResolvedValue([
      published({
        deactivated_at: '2026-08-23T10:00:00.000Z',
        archived_at: '2026-08-24T10:00:00.000Z',
      }),
    ]);
    renderRoute();

    fireEvent.click(await screen.findByLabelText('Show archived'));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'More actions for Published electrical inspection',
      }),
    );

    expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Reactivate template' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => expect(restoreTemplate).toHaveBeenCalledWith(published().id));
  });

  it('enlaza la publicada a la versión que la fila nombra', async () => {
    listPublishedTemplates.mockResolvedValue([published()]);

    renderRoute();

    const link = await screen.findByRole('link', { name: 'Published electrical inspection' });

    expect(link.getAttribute('href')).toBe(
      `/templates/versions/${published().latest_version_id}`,
    );
  });

  it('explica cómo llenar la lista cuando no hay publicadas', async () => {
    listPublishedTemplates.mockResolvedValue([]);

    renderRoute();

    expect(await screen.findByText('No published templates yet')).toBeTruthy();
    expect(screen.getByText('Publish a completed draft to fill this list.')).toBeTruthy();
  });

  it('mueve la fila del bloque de borradores al de publicadas al refrescar', async () => {
    const queryClient = renderRoute();

    await screen.findByText('Monthly electrical inspection');
    listTemplateDrafts.mockResolvedValue([]);
    listPublishedTemplates.mockResolvedValue([published({ name: 'Monthly electrical inspection' })]);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['template-drafts'] }),
      queryClient.invalidateQueries({ queryKey: ['published-templates'] }),
    ]);

    await waitFor(() =>
      expect(screen.queryByText('Monthly electrical inspection')).toBeTruthy(),
    );
    const publishedBlock = screen
      .getByRole('heading', { name: 'Published templates' })
      .closest('section');

    expect(within(publishedBlock!).getByText('Monthly electrical inspection')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your drafts' })).toBeNull();
  });
});

/**
 * Las fichas del encabezado no son un adorno: son la comparación que el coordinador hace
 * de verdad —cuánto empezó contra cuánto llegó a publicar—, y tienen que decir el mismo
 * número que los encabezados de las dos tarjetas de abajo.
 */
describe('los conteos del encabezado', () => {
  function count(label: string): string | null {
    const term = screen.getByText(label, { selector: 'dt' });

    return within(term.parentElement!).getByRole('definition').textContent;
  }

  it('cuenta las dos poblaciones por separado', async () => {
    listTemplateDrafts.mockResolvedValue([draft(), draft({ id: OTHER_DRAFT })]);
    listPublishedTemplates.mockResolvedValue([published()]);

    renderRoute();

    await screen.findByText('Published electrical inspection');

    expect(count('Drafts')).toBe('2');
    expect(count('Published')).toBe('1');
  });

  it('no cuenta las archivadas entre las publicadas visibles', async () => {
    listPublishedTemplates.mockResolvedValue([
      published(),
      published({
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Archived inspection',
        deactivated_at: '2026-08-23T10:00:00.000Z',
        archived_at: '2026-08-24T10:00:00.000Z',
      }),
    ]);

    renderRoute();

    await screen.findByText('Published electrical inspection');

    expect(count('Published')).toBe('1');
    expect(screen.getByRole('heading', { name: 'Published templates' }).textContent).toContain('(1)');
  });

  /** "0 drafts" mientras la consulta falla es una afirmación falsa sobre el trabajo de alguien. */
  it('no dice cero cuando lo que hay es un error', async () => {
    listPublishedTemplates.mockRejectedValue(new Error('offline'));

    renderRoute();

    await screen.findByText('Monthly electrical inspection');

    expect(count('Drafts')).toBe('1');
    await waitFor(() => expect(count('Published')).toBe('—'));
  });
});

describe('empezar una plantilla', () => {
  async function openStartTemplate(): Promise<HTMLElement> {
    const trigger = await screen.findByRole('button', { name: 'Add Template' });
    trigger.focus();
    fireEvent.click(trigger);

    return screen.findByRole('dialog', { name: 'Start Template' });
  }

  it('abre el formulario desde la acción de la tabla publicada', async () => {
    renderRoute();

    expect(screen.queryByRole('dialog', { name: 'Start Template' })).toBeNull();

    const dialog = await openStartTemplate();

    expect(within(dialog).getByRole('heading', { name: 'Start Template' })).toBeTruthy();
    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
  });

  it('cierra el diálogo sin crear y devuelve el foco a Add Template', async () => {
    renderRoute();

    const dialog = await openStartTemplate();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Start Template' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Template' }));
    expect(createTemplateDraft).not.toHaveBeenCalled();
  });

  /**
   * La decisión de fondo de la pantalla: la clave es del servidor. Pedirla acá era pedirle
   * al coordinador una decisión que no tiene forma de tomar bien, y abría la puerta a dos
   * borradores con el mismo nombre y claves distintas.
   */
  it('pide el nombre y NADA más: la clave no se escribe', async () => {
    renderRoute();
    const dialog = await openStartTemplate();

    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Key')).toBeNull();
  });

  it('no deja crear sin nombre', async () => {
    renderRoute();
    const dialog = await openStartTemplate();

    expect((within(dialog).getByRole('button', { name: 'Create draft' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('crea y abre el borrador nuevo', async () => {
    renderRoute();
    const dialog = await openStartTemplate();

    const name = within(dialog).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Monthly electrical' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() =>
      expect(createTemplateDraft).toHaveBeenCalledWith({ name: 'Monthly electrical' }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/templates/drafts/$id',
        params: { id: OTHER_DRAFT },
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Start Template' })).toBeNull();
  });

  /** El rechazo más probable de la pantalla, y no puede perder lo escrito. */
  it('muestra el rechazo de un nombre tomado sin vaciar el formulario', async () => {
    createTemplateDraft.mockRejectedValue(
      new Error('A template called "Monthly electrical" already exists. Choose a different name.'),
    );

    renderRoute();
    const dialog = await openStartTemplate();

    const name = within(dialog).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Monthly electrical' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    expect(await within(dialog).findByText(/already exists/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value)
      .toBe('Monthly electrical');
    expect(navigate).not.toHaveBeenCalled();
  });

  /** `"???"` pasa el filtro del cliente y lo rechaza el servidor; el aviso se lee igual. */
  it('muestra el rechazo de un nombre del que no sale ninguna clave', async () => {
    createTemplateDraft.mockRejectedValue(
      new Error('The name needs at least one letter or digit'),
    );

    renderRoute();
    const dialog = await openStartTemplate();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '???' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    expect(await within(dialog).findByText(/at least one letter or digit/)).toBeTruthy();
  });
});

/**
 * El «⋮» de un borrador, con las mismas entradas que la tabla de arriba resuelve así.
 *
 * Lo que estos tests fijan no es que exista un menú: es QUÉ ofrece y cuándo. Publicar
 * aparece solo cuando el borrador está completo, porque el servidor rechaza el otro caso
 * (`template_draft_not_publishable`) y un ítem que solo puede fallar no es una opción.
 */
describe('el menú de un borrador', () => {
  it('abre el borrador para editarlo', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit draft' }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/templates/drafts/$id',
      params: { id: DRAFT },
    });
  });

  it('ofrece publicar el que ya está listo', async () => {
    listTemplateDrafts.mockResolvedValue([draft({ publishable: true })]);

    renderRoute();

    expect(
      within(await openDraftMenu()).getByRole('menuitem', { name: 'Publish' }),
    ).toBeTruthy();
  });

  it('no lo ofrece mientras al borrador le falte algo', async () => {
    renderRoute();

    expect(
      within(await openDraftMenu()).queryByRole('menuitem', { name: 'Publish' }),
    ).toBeNull();
  });
});

describe('publicar desde el listado', () => {
  beforeEach(() => {
    listTemplateDrafts.mockResolvedValue([draft({ publishable: true })]);
  });

  /**
   * Publicar es un punto de no retorno y se confirma nombrando la versión que va a escribir:
   * es el mismo diálogo del builder (`components/PublishDialog`), montado desde acá.
   */
  it('pide confirmación nombrando la versión', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }));

    expect(screen.getByText('Publish “Monthly electrical inspection”?')).toBeTruthy();
    expect(screen.getByText(/This creates version 1/)).toBeTruthy();
    expect(publishTemplateDraft).not.toHaveBeenCalled();
  });

  /** Una revisión dice lo otro: la versión que reemplaza se sigue leyendo. */
  it('dice qué pasa con la versión anterior cuando es una revisión', async () => {
    listTemplateDrafts.mockResolvedValue([
      draft({ publishable: true, template_id: published().id, next_version: 3 }),
    ]);

    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }));

    expect(screen.getByText(/This creates version 3/)).toBeTruthy();
    expect(screen.getByText(/stays readable/)).toBeTruthy();
  });

  it('publica al confirmar', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish template' }));

    await waitFor(() => expect(publishTemplateDraft).toHaveBeenCalledWith(DRAFT));
  });

  it('no publica si se elige seguir editando', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(publishTemplateDraft).not.toHaveBeenCalled();
  });

  /** El rechazo se lee en el diálogo, que es donde está la decisión que se acaba de tomar. */
  it('muestra el rechazo del servidor sin cerrar nada', async () => {
    publishTemplateDraft.mockRejectedValue(new Error('The draft is not publishable'));

    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish template' }));

    expect(await screen.findByText(/not publishable/)).toBeTruthy();
  });
});

describe('descartar', () => {
  it('pide confirmación antes de hacer nada', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Discard this draft' }));

    expect(screen.getByText('Discard “Monthly electrical inspection”?')).toBeTruthy();
    expect(discardTemplateDraft).not.toHaveBeenCalled();
  });

  it('aclara que no se borra nada', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Discard this draft' }));

    expect(screen.getByText(/Nothing is deleted/)).toBeTruthy();
  });

  it('descarta al confirmar', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Discard this draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(discardTemplateDraft).toHaveBeenCalledWith(DRAFT));
  });

  it('no descarta si se elige conservarlo', async () => {
    renderRoute();

    const menu = await openDraftMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Discard this draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(discardTemplateDraft).not.toHaveBeenCalled();
  });
});
