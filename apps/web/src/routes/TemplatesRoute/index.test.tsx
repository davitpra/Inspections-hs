import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, TemplateDraftSummary, TemplateOption } from '@hs/contracts';

import { TemplatesRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const OTHER_DRAFT = '55555555-5555-4555-8555-555555555555';

const listTemplateDrafts = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const createTemplateDraft = vi.hoisted(() => vi.fn());
const discardTemplateDraft = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/templates', () => ({
  listTemplateDrafts,
  createTemplateDraft,
  discardTemplateDraft,
}));

vi.mock('../../api/inspections', () => ({ listTemplates }));

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
      recordsFrom: null,
      recordsTo: null,
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

function published(overrides: Partial<TemplateOption> = {}): TemplateOption {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    key: 'published-electrical',
    name: 'Published electrical inspection',
    latest_version: 1,
    latest_version_id: '77777777-7777-4777-8777-777777777777',
    latest_published_at: '2026-08-22 10:00:00+00',
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

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
  listTemplateDrafts.mockReset().mockResolvedValue([draft()]);
  listTemplates.mockReset().mockResolvedValue([]);
  createTemplateDraft.mockReset().mockResolvedValue({
    ...draft({ id: OTHER_DRAFT }),
    document: { sections: [] },
    issues: [],
  });
  discardTemplateDraft.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede escribir plantillas', () => {
  it('se la ofrece al coordinador', async () => {
    renderRoute();

    expect(await screen.findByText('Monthly electrical inspection')).toBeTruthy();
  });

  /**
   * Y sin disparar la consulta: pedir algo que el servidor va a negar con 403 solo sirve
   * para llenar el log. Es lo mismo que hace `RosterRoute`.
   */
  it.each(['jhsc_member', 'supervisor', 'management', 'external_auditor'] as const)(
    'se la niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only the H&S coordinator can write templates/)).toBeTruthy();
      expect(listTemplateDrafts).not.toHaveBeenCalled();
    },
  );
});

describe('el listado', () => {
  it('explica que publicar congela la versión', async () => {
    renderRoute();

    await screen.findByText('Monthly electrical inspection');

    expect(screen.getByText(/Published versions are frozen/))
      .toBeTruthy();
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
    expect(screen.getByText(/Start one above/)).toBeTruthy();
  });

  it('sin conexión lo dice en vez de mostrar una lista vacía', async () => {
    listTemplateDrafts.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/This view needs a connection/)).toBeTruthy();
  });
});

describe('las plantillas publicadas', () => {
  it('muestra una publicada y no mezcla el borrador en ese bloque', async () => {
    listTemplates.mockResolvedValue([published()]);

    renderRoute();

    await screen.findByText('Published electrical inspection');
    const publishedBlock = screen
      .getByRole('heading', { name: 'Published templates' })
      .closest('section');

    expect(publishedBlock).toBeTruthy();
    expect(within(publishedBlock!).getByText('Published electrical inspection')).toBeTruthy();
    expect(within(publishedBlock!).getByText(/published-electrical/)).toBeTruthy();
    expect(within(publishedBlock!).getByText(/Version 1/)).toBeTruthy();
    expect(within(publishedBlock!).getByText(/published 2026-08-22/)).toBeTruthy();
    expect(within(publishedBlock!).queryByText('Monthly electrical inspection')).toBeNull();
  });

  it('enlaza la publicada a la versión que la fila nombra', async () => {
    listTemplates.mockResolvedValue([published()]);

    renderRoute();

    const link = await screen.findByRole('link', { name: 'Published electrical inspection' });

    expect(link.getAttribute('href')).toBe(
      `/templates/versions/${published().latest_version_id}`,
    );
  });

  it('explica cómo llenar la lista cuando no hay publicadas', async () => {
    listTemplates.mockResolvedValue([]);

    renderRoute();

    expect(await screen.findByText('No published templates yet')).toBeTruthy();
    expect(screen.getByText('Publish a completed draft to fill this list.')).toBeTruthy();
  });

  it('mueve la fila del bloque de borradores al de publicadas al refrescar', async () => {
    const queryClient = renderRoute();

    await screen.findByText('Monthly electrical inspection');
    listTemplateDrafts.mockResolvedValue([]);
    listTemplates.mockResolvedValue([published({ name: 'Monthly electrical inspection' })]);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['template-drafts'] }),
      queryClient.invalidateQueries({ queryKey: ['templates'] }),
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
    listTemplates.mockResolvedValue([published()]);

    renderRoute();

    await screen.findByText('Published electrical inspection');

    expect(count('Drafts')).toBe('2');
    expect(count('Published')).toBe('1');
  });

  /** "0 drafts" mientras la consulta falla es una afirmación falsa sobre el trabajo de alguien. */
  it('no dice cero cuando lo que hay es un error', async () => {
    listTemplates.mockRejectedValue(new Error('offline'));

    renderRoute();

    await screen.findByText('Monthly electrical inspection');

    expect(count('Drafts')).toBe('1');
    await waitFor(() => expect(count('Published')).toBe('—'));
  });
});

describe('empezar una plantilla', () => {
  /**
   * La decisión de fondo de la pantalla: la clave es del servidor. Pedirla acá era pedirle
   * al coordinador una decisión que no tiene forma de tomar bien, y abría la puerta a dos
   * borradores con el mismo nombre y claves distintas.
   */
  it('pide el nombre y NADA más: la clave no se escribe', async () => {
    renderRoute();

    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect(screen.queryByLabelText('Key')).toBeNull();
  });

  it('no deja crear sin nombre', async () => {
    renderRoute();

    await screen.findByLabelText('Name');

    expect((screen.getByRole('button', { name: 'Create draft' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('crea y abre el borrador nuevo', async () => {
    renderRoute();

    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Monthly electrical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() =>
      expect(createTemplateDraft).toHaveBeenCalledWith({ name: 'Monthly electrical' }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/templates/drafts/$id',
        params: { id: OTHER_DRAFT },
      }),
    );
  });

  /** El rechazo más probable de la pantalla, y no puede perder lo escrito. */
  it('muestra el rechazo de un nombre tomado sin vaciar el formulario', async () => {
    createTemplateDraft.mockRejectedValue(
      new Error('A template called "Monthly electrical" already exists. Choose a different name.'),
    );

    renderRoute();

    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Monthly electrical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText(/already exists/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Monthly electrical');
    expect(navigate).not.toHaveBeenCalled();
  });

  /** `"???"` pasa el filtro del cliente y lo rechaza el servidor; el aviso se lee igual. */
  it('muestra el rechazo de un nombre del que no sale ninguna clave', async () => {
    createTemplateDraft.mockRejectedValue(
      new Error('The name needs at least one letter or digit'),
    );

    renderRoute();

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '???' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText(/at least one letter or digit/)).toBeTruthy();
  });
});

describe('descartar', () => {
  it('pide confirmación antes de hacer nada', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Discard Monthly electrical inspection' }));

    expect(screen.getByText('Discard “Monthly electrical inspection”?')).toBeTruthy();
    expect(discardTemplateDraft).not.toHaveBeenCalled();
  });

  it('aclara que no se borra nada', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Discard Monthly electrical inspection' }));

    expect(screen.getByText(/Nothing is deleted/)).toBeTruthy();
  });

  it('descarta al confirmar', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Discard Monthly electrical inspection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(discardTemplateDraft).toHaveBeenCalledWith(DRAFT));
  });

  it('no descarta si se elige conservarlo', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Discard Monthly electrical inspection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(discardTemplateDraft).not.toHaveBeenCalled();
  });
});
