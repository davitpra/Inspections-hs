import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InspectionSchedule,
  InspectorOption,
  ScheduledInspection,
  Session,
  Site,
} from '@hs/contracts';

import { SchedulingRoute } from './SchedulingRoute';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const SCHEDULED = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const VERSION = '66666666-6666-4666-8666-666666666666';
const RULE = '77777777-7777-4777-8777-777777777777';
const CANDIDATE = '88888888-8888-4888-8888-888888888888';
const OTHER_TEMPLATE = '99999999-9999-4999-8999-999999999999';
const OTHER_VERSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const listSites = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const listInspectorCandidates = vi.hoisted(() => vi.fn());
const listSchedules = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const updateSchedule = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const assignInspector = vi.hoisted(() => vi.fn());
const cancelScheduledInspection = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../api/inspections', () => ({
  listSites,
  listTemplates,
  listInspectorCandidates,
  listSchedules,
  createSchedule,
  updateSchedule,
  listScheduled,
  assignInspector,
  cancelScheduledInspection,
}));

vi.mock('../app/session-context', () => ({ useAppSession }));

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

function site(): Site {
  return { id: SITE, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null };
}

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return {
    id: RULE,
    site_id: SITE,
    template_id: TEMPLATE,
    template_name: 'Monthly general workplace inspection',
    default_inspector_id: null,
    default_inspector_name: null,
    deactivated_at: null,
    ...overrides,
  };
}

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return {
    id: SCHEDULED,
    site_id: SITE,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    template_id: TEMPLATE,
    template_name: 'Monthly general workplace inspection',
    template_version_id: VERSION,
    template_version: 2,
    inspector_id: null,
    inspector_name: null,
    scheduled_at: '2026-08-01T07:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    status: 'open',
    ...overrides,
  };
}

function candidate(overrides: Partial<InspectorOption> = {}): InspectorOption {
  return {
    id: CANDIDATE,
    employee_number: 'E-4471',
    first_name: 'Dana',
    last_name: 'Okafor',
    ...overrides,
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <SchedulingRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listSites.mockReset().mockResolvedValue([site()]);
  // Dos plantillas: una ya tiene regla activa acá y la otra no. Así el alta se puede
  // ofrecer por defecto, y el caso "ya está tomada" se arma quitando la libre.
  listTemplates.mockReset().mockResolvedValue([
    {
      id: TEMPLATE,
      name: 'Monthly general workplace inspection',
      latest_version: 2,
      latest_version_id: VERSION,
    },
    {
      id: OTHER_TEMPLATE,
      name: 'Quarterly electrical inspection',
      latest_version: 1,
      latest_version_id: OTHER_VERSION,
    },
  ]);
  listInspectorCandidates.mockReset().mockResolvedValue([candidate()]);
  listSchedules.mockReset().mockResolvedValue([rule()]);
  createSchedule.mockReset().mockResolvedValue(rule());
  updateSchedule.mockReset().mockResolvedValue(rule({ deactivated_at: '2026-08-05T00:00:00.000Z' }));
  listScheduled.mockReset().mockResolvedValue([inspection()]);
  assignInspector.mockReset().mockResolvedValue(inspection({ inspector_id: CANDIDATE }));
  cancelScheduledInspection.mockReset().mockResolvedValue(inspection());
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  // `globals: false` desactiva el cleanup automático.
  cleanup();
  vi.clearAllMocks();
});

describe('quién puede administrar', () => {
  it('el coordinador ve asignar, cancelar y nueva regla', async () => {
    renderRoute();

    expect(await screen.findByLabelText('Assign')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel this period' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeTruthy();
  });

  /**
   * La ruta es alcanzable por URL para cualquier rol y se lee entera; lo que no aparece
   * es un solo control de escritura. El servidor los rechaza igual — la comprobación del
   * cliente solo evita ofrecer algo que va a fallar.
   */
  it('un jhsc_member ve las listas y ningún control', async () => {
    useAppSession.mockReturnValue(session('jhsc_member'));

    renderRoute();

    // Aparece dos veces: en la regla y en el período que esa regla abrió.
    expect((await screen.findAllByText('Monthly general workplace inspection')).length).toBe(2);
    expect(screen.queryByLabelText('Assign')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this period' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull();
  });
});

describe('lo que no tiene inspector', () => {
  it('lo marca y explica que no está en la lista de nadie', async () => {
    renderRoute();

    expect(await screen.findByText('Unassigned')).toBeTruthy();
    expect(screen.getByText(/appear in nobody's pending list/)).toBeTruthy();
  });

  it('asignar llama al endpoint con el candidato elegido', async () => {
    renderRoute();

    // La opción, no solo la etiqueta: el `<select>` se dibuja antes de que lleguen los
    // candidatos, y un `change` a un valor que todavía no existe no cambia nada.
    await screen.findByRole('option', { name: 'Dana Okafor (E-4471)' });
    const select = screen.getByLabelText('Assign');
    fireEvent.change(select, { target: { value: CANDIDATE } });

    await waitFor(() => {
      expect(assignInspector).toHaveBeenCalledWith(SCHEDULED, CANDIDATE);
    });
  });

  it('pide los candidatos de la planta de la fila', async () => {
    renderRoute();

    await screen.findByLabelText('Assign');

    expect(listInspectorCandidates).toHaveBeenCalledWith(SITE);
  });
});

/**
 * Es el único lugar donde el coordinador se entera de que una cuenta perdió el alcance.
 * Sin actualización optimista: la fila conserva lo que tenía y el motivo se lee.
 */
describe('cuando el servidor rechaza la asignación', () => {
  it('muestra el mensaje y no pinta el cambio', async () => {
    assignInspector.mockRejectedValue(
      new Error('The account has no active access to site St. Thomas'),
    );

    renderRoute();

    await screen.findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(screen.getByLabelText('Assign'), { target: { value: CANDIDATE } });

    expect(await screen.findByText(/no active access/)).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});

describe('cancelar', () => {
  it('no se puede enviar sin motivo', async () => {
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Cancel this period' });

    expect(button.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Cancel with a reason'), {
      target: { value: 'plant shutdown' },
    });

    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('manda el motivo escrito', async () => {
    renderRoute();

    fireEvent.change(await screen.findByLabelText('Cancel with a reason'), {
      target: { value: 'plant shutdown' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this period' }));

    await waitFor(() => {
      expect(cancelScheduledInspection).toHaveBeenCalledWith(SCHEDULED, 'plant shutdown');
    });
  });

  it('avisa que no se deshace', async () => {
    renderRoute();

    expect(await screen.findByText(/cannot be undone/)).toBeTruthy();
  });
});

describe('la nueva regla', () => {
  /**
   * La mitad cliente de la unicidad: el servidor responde `schedule_already_active`
   * igual, y no ofrecer la plantilla evita que el coordinador provoque ese error
   * haciendo lo único que la pantalla le ofrece.
   */
  it('no ofrece la plantilla que ya tiene regla activa acá', async () => {
    renderRoute();

    await screen.findByRole('option', { name: 'Quarterly electrical inspection (v1)' });
    const select = screen.getByLabelText('New rule');
    const offered = Array.from(select.querySelectorAll('option')).map((option) => option.value);

    expect(offered).toContain(OTHER_TEMPLATE);
    expect(offered).not.toContain(TEMPLATE);
  });

  it('avisa cuando ya no queda ninguna por ofrecer', async () => {
    listTemplates.mockResolvedValue([
      {
        id: TEMPLATE,
        name: 'Monthly general workplace inspection',
        latest_version: 2,
        latest_version_id: VERSION,
      },
    ]);

    renderRoute();

    expect(
      await screen.findByText('Every published template already has an active rule here.'),
    ).toBeTruthy();
  });

  // Desactivar libera la plantilla: 0008 deja recrear una regla desactivada.
  it('vuelve a ofrecer la plantilla cuya regla está desactivada', async () => {
    listSchedules.mockResolvedValue([rule({ deactivated_at: '2026-07-01T00:00:00.000Z' })]);

    renderRoute();

    await screen.findByRole('option', { name: 'Monthly general workplace inspection (v2)' });
    fireEvent.change(screen.getByLabelText('New rule'), { target: { value: TEMPLATE } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith({ site_id: SITE, template_id: TEMPLATE });
    });
  });
});

/**
 * Toda la razón de las tres lecturas de apoyo. Si esto se pone rojo es que algún campo
 * volvió a mostrarse como identificador.
 */
describe('nombres y no identificadores', () => {
  it('no muestra ningún uuid en la pantalla', async () => {
    listScheduled.mockResolvedValue([
      inspection({ inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' }),
    ]);

    const { container } = renderRoute();

    await screen.findByText('Dana Okafor');

    expect(container.textContent).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it('con una sola planta en el alcance no dibuja un selector de una opción', async () => {
    renderRoute();

    expect(await screen.findByText('Site: St. Thomas')).toBeTruthy();
    expect(screen.queryByLabelText('Site')).toBeNull();
  });
});
