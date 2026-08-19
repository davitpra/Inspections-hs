import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftIssues, type Session, type TemplateDraft } from '@hs/contracts';

import { TemplateDraftRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';

const getTemplateDraft = vi.hoisted(() => vi.fn());
const saveTemplateDraft = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const listOrganizationLocations = vi.hoisted(() => vi.fn());

vi.mock('../../api/templates', () => ({ getTemplateDraft, saveTemplateDraft }));
vi.mock('../../api/catalog', () => ({ listOrganizationLocations }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/templates">{children}</a>,
  useParams: () => ({ id: DRAFT }),
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

const LOCATIONS = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'guarding',
    name: 'Guarding',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    code: 'storage',
    name: 'Storage',
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    code: 'machines',
    name: 'Machines',
  },
];

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
          },
        ],
      },
    ],
  };

  return {
    id: DRAFT,
    key: 'monthly-electrical',
    name: 'Monthly electrical inspection',
    revision: 4,
    updated_at: '2026-08-14T10:00:00.000Z',
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
}

/** El cuerpo del último `saveTemplateDraft`. */
function lastSave(): { name: string; document: unknown; revision: number } {
  const call = saveTemplateDraft.mock.calls.at(-1);

  if (!call) throw new Error('No se llamó a saveTemplateDraft.');

  return call[1];
}

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
  getTemplateDraft.mockReset().mockResolvedValue(draft());
  listOrganizationLocations.mockReset().mockResolvedValue(LOCATIONS);
  saveTemplateDraft
    .mockReset()
    .mockImplementation(async (_id: string, body: { name: string; document: never }) =>
      draft({ ...body, revision: 5 }),
    );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede escribir plantillas', () => {
  it.each(['jhsc_member', 'supervisor', 'management', 'external_auditor'] as const)(
    'se lo niega a %s, y sin llamar a la API',
    (role) => {
      useAppSession.mockReturnValue(session(role));

      renderRoute();

      expect(screen.getByText(/Only the H&S coordinator can write templates/)).toBeTruthy();
      expect(getTemplateDraft).not.toHaveBeenCalled();
    },
  );
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

    expect(screen.getAllByLabelText('Question')).toHaveLength(2);
  });

  it('no muestra claves técnicas de secciones ni preguntas', async () => {
    renderRoute();
    await ready();

    expect(screen.queryByLabelText('Key')).toBeNull();
  });

  it('quita una pregunta', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Is the guard fitted?' }));

    expect(screen.queryByLabelText('Question')).toBeNull();
  });
});

describe('reordenar', () => {
  async function twoSections(): Promise<void> {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getAllByLabelText('Location')[1]!, { target: { value: 'storage' } });
  }

  it('sube una sección', async () => {
    await twoSections();

    fireEvent.click(screen.getByRole('button', { name: 'Move section Storage up' }));

    const titles = (screen.getAllByLabelText('Location') as HTMLSelectElement[]).map(
      (input) => input.value,
    );
    expect(titles).toEqual(['storage', 'guarding']);
  });

  /**
   * Deshabilitados y no ocultos: un botón que aparece y desaparece mueve los de al lado
   * bajo el dedo, que en una tablet con guantes es cómo se toca el equivocado.
   */
  it('los botones de los extremos están deshabilitados, no ausentes', async () => {
    await twoSections();

    expect(
      (screen.getByRole('button', { name: 'Move section Guarding up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Move section Storage down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('sube una pregunta dentro de su sección', async () => {
    renderRoute();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.change(screen.getAllByLabelText('Question')[1]!, {
      target: { value: 'Is the exit clear?' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move Is the exit clear? up' }));

    const prompts = (screen.getAllByLabelText('Question') as HTMLInputElement[]).map(
      (input) => input.value,
    );
    expect(prompts).toEqual(['Is the exit clear?', 'Is the guard fitted?']);
  });
});

describe('el tipo de respuesta', () => {
  it('cambiar de tipo reemplaza los campos de configuración', async () => {
    renderRoute();
    await ready();

    const type = screen.getByLabelText('Answered with');

    fireEvent.change(type, { target: { value: 'text' } });
    expect(screen.getByLabelText('Maximum length')).toBeTruthy();

    fireEvent.change(type, { target: { value: 'single_choice' } });
    expect(screen.queryByLabelText('Maximum length')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add option' })).toBeTruthy();
  });

  it('un tipo sin configuración no muestra ningún campo de más', async () => {
    renderRoute();
    await ready();

    const type = screen.getByLabelText('Answered with');

    fireEvent.change(type, { target: { value: 'number' } });
    expect(screen.getByLabelText('Decimal places')).toBeTruthy();

    fireEvent.change(type, { target: { value: 'signature' } });
    expect(screen.queryByLabelText('Decimal places')).toBeNull();
    expect(screen.queryByLabelText('Minimum')).toBeNull();
  });

  it('las opciones se escriben con etiqueta y valor por separado', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getByLabelText('Answered with'), {
      target: { value: 'single_choice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Fitted' } });
    fireEvent.change(screen.getByLabelText('Stored value'), { target: { value: 'fitted' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalled());

    expect(JSON.stringify(lastSave().document)).toContain('"value":"fitted"');
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

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: '' } });

    expect(screen.getByText(/has no question text/)).toBeTruthy();
  });
});

describe('guardar', () => {
  it('manda el documento y la revisión sobre la que se editó', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'machines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveTemplateDraft).toHaveBeenCalledWith(DRAFT, expect.anything()));

    const body = lastSave();
    expect(body.revision).toBe(4);
    expect(JSON.stringify(body.document)).toContain('"section_title":"Machines"');
  });

  it('el botón dice "Saved" mientras no haya cambios', async () => {
    renderRoute();
    await ready();

    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('después de guardar avanza la revisión y vuelve a "Saved"', async () => {
    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'machines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await screen.findByRole('button', { name: 'Saved' });

    expect(screen.getByText(/saved revision 5/)).toBeTruthy();
  });

  /**
   * El caso que justifica el lock: dos pestañas del mismo autor. El rechazo NO puede
   * descartar lo escrito para volver a mostrar lo que el servidor tiene.
   */
  it('un guardado rechazado se avisa y no pierde lo editado', async () => {
    saveTemplateDraft.mockRejectedValue(
      new Error('This draft was changed somewhere else. Reload it before saving again.'),
    );

    renderRoute();
    await ready();

    fireEvent.change(screen.getAllByLabelText('Location')[0]!, { target: { value: 'machines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/changed somewhere else/)).toBeTruthy();
    expect(screen.getByText(/Nothing you typed has been lost/)).toBeTruthy();
    expect((screen.getAllByLabelText('Location')[0] as HTMLSelectElement).value).toBe('machines');
  });

  it('sin conexión no monta el editor sobre un documento que no llegó', async () => {
    getTemplateDraft.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('offline')).toBeTruthy();
    expect(screen.queryByLabelText('Template name')).toBeNull();
  });
});

describe('la cabecera', () => {
  it('cuenta secciones y preguntas', async () => {
    renderRoute();
    await ready();

    const header = screen.getByText(/section\(s\)/);

    expect(within(header).getByText(/1 question/)).toBeTruthy();
  });

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
});
