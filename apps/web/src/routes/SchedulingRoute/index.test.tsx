import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InspectionSchedule,
  InspectorOption,
  ScheduledInspection,
  Session,
  Site,
} from '@hs/contracts';

import { SchedulingRoute } from './index';

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
const OTHER_SITE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLOSED_SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const listSites = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const listInspectorCandidates = vi.hoisted(() => vi.fn());
const listSchedules = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const updateSchedule = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const createScheduledInspection = vi.hoisted(() => vi.fn());
const assignInspector = vi.hoisted(() => vi.fn());
const cancelScheduledInspection = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({
  listSites,
  listTemplates,
  listInspectorCandidates,
  listSchedules,
  createSchedule,
  updateSchedule,
  listScheduled,
  createScheduledInspection,
  assignInspector,
  cancelScheduledInspection,
}));

vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(
  role: Session['role'],
  siteScope: readonly string[] = [SITE],
): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: [...siteScope],
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
    created_at: '2020-01-01T00:00:00.000Z',
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
    inspection_id: null,
    completed_at: null,
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
  createScheduledInspection.mockReset().mockResolvedValue(
    inspection({ period_start: '2026-12-01', period_end: '2026-12-31', inspector_id: CANDIDATE }),
  );
  assignInspector.mockReset().mockResolvedValue(inspection({ inspector_id: CANDIDATE }));
  cancelScheduledInspection.mockReset().mockResolvedValue(inspection());
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  // `globals: false` desactiva el cleanup automático.
  cleanup();
  vi.clearAllMocks();
});

/** Abre el menú de la fila de agosto y devuelve el menú, con las acciones que ofrezca. */
async function openPeriodMenu(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /More actions for August/ }));

  return screen.getByRole('menu');
}

describe('quién puede administrar', () => {
  it('el coordinador ve asignar, cancelar y nueva regla', async () => {
    renderRoute();

    expect(await screen.findByLabelText('Assign')).toBeTruthy();
    expect(
      within(await openPeriodMenu()).getByRole('menuitem', { name: 'Cancel this period' }),
    ).toBeTruthy();
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

    // Aparece en la regla y en las doce casillas del año que esa regla proyecta.
    expect((await screen.findAllByText('Monthly general workplace inspection')).length).toBe(13);
    expect(screen.queryByLabelText('Assign')).toBeNull();
    expect(screen.queryByLabelText('Default inspector')).toBeNull();
    expect(screen.getByText('Default inspector: none')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull();
    expect(screen.queryByLabelText('Inspector')).toBeNull();
    expect(screen.queryByText(/Open this month/)).toBeNull();
  });
});

describe('el inspector por defecto de la regla', () => {
  it('el coordinador lo elige con un selector, no solo lo lee', async () => {
    renderRoute();

    const select = await screen.findByLabelText('Default inspector');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith(RULE, { default_inspector_id: CANDIDATE });
    });
  });

  it('elegir "None" lo limpia', async () => {
    listSchedules.mockResolvedValue([rule({ default_inspector_id: CANDIDATE, default_inspector_name: 'Dana Okafor' })]);

    renderRoute();

    const select = await screen.findByLabelText('Default inspector');
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith(RULE, { default_inspector_id: null });
    });
  });
});

describe('lo que no tiene inspector', () => {
  it('lo marca y explica que no está en la lista de nadie', async () => {
    renderRoute();

    expect(
      await screen.findByText('Unassigned', { selector: '.status-pill' }),
    ).toBeTruthy();
    expect(screen.getByText(/appear in nobody's pending list/)).toBeTruthy();
  });

  /** Elegir no manda nada; el botón sí. Recorrer la lista con el teclado no asigna. */
  it('asignar llama al endpoint con el candidato elegido, y recién al confirmar', async () => {
    renderRoute();

    // La opción, no solo la etiqueta: el `<select>` se dibuja antes de que lleguen los
    // candidatos, y un `change` a un valor que todavía no existe no cambia nada.
    const select = await screen.findByLabelText('Assign');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });

    expect(assignInspector).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Assign inspector' }));

    await waitFor(() => {
      expect(assignInspector).toHaveBeenCalledWith(SCHEDULED, CANDIDATE);
    });
  });

  /** Sin elegir a nadie no hay nada que mandar, y el botón lo dice apagándose. */
  it('el botón nace deshabilitado', async () => {
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Assign inspector' });

    expect(button.hasAttribute('disabled')).toBe(true);
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

    const select = await screen.findByLabelText('Assign');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign inspector' }));

    expect(await screen.findByText(/no active access/)).toBeTruthy();
    expect(screen.getByText('Unassigned', { selector: '.status-pill' })).toBeTruthy();
    // El selector vuelve a lo que la fila tiene, no se queda con el intento fallido.
    expect((select as HTMLSelectElement).value).toBe('');
  });
});

describe('cancelar', () => {
  /** Abre el modal desde el menú de la fila y devuelve su botón de confirmar. */
  const openDialog = async (): Promise<HTMLElement> => {
    const menu = await openPeriodMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cancel this period' }));

    return screen.getByRole('button', { name: 'Confirm cancellation' });
  };

  it('no se ofrece en el cuerpo de la fila, sino en el menú', async () => {
    renderRoute();

    await screen.findByRole('button', { name: /More actions for August/ });
    expect(screen.queryByRole('menuitem', { name: 'Cancel this period' })).toBeNull();
  });

  it('el motivo no se pide en la fila, sino al confirmar', async () => {
    renderRoute();

    const menu = await openPeriodMenu();
    expect(screen.queryByLabelText('Cancel with a reason')).toBeNull();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cancel this period' }));
    expect(screen.getByLabelText('Cancel with a reason')).toBeTruthy();
  });

  it('no se puede confirmar sin motivo', async () => {
    renderRoute();

    const confirm = await openDialog();

    expect(confirm.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Cancel with a reason'), {
      target: { value: 'plant shutdown' },
    });

    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('manda el motivo escrito', async () => {
    renderRoute();

    const confirm = await openDialog();

    fireEvent.change(screen.getByLabelText('Cancel with a reason'), {
      target: { value: 'plant shutdown' },
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(cancelScheduledInspection).toHaveBeenCalledWith(SCHEDULED, 'plant shutdown');
    });
  });

  it('avisa que no se deshace al confirmar', async () => {
    renderRoute();

    await openDialog();

    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
  });

  /**
   * La otra mitad de "no se deshace": el mes sigue debiéndose. El menú del mes cancelado
   * no ofrece cancelar de nuevo ni asignar —no hay nada que asignar—, sino la única salida
   * que el motor acepta, que es programarlo otra vez como una fila nueva.
   */
  describe('el mes cancelado', () => {
    beforeEach(() => {
      listScheduled.mockResolvedValue([
        inspection({
          status: 'cancelled',
          cancelled_at: '2026-08-05T00:00:00.000Z',
          cancellation_reason: 'Plant shutdown',
        }),
      ]);
    });

    it('se puede volver a programar desde el menú, con inspector y todo', async () => {
      renderRoute();

      fireEvent.click(
        within(await openPeriodMenu()).getByRole('menuitem', {
          name: 'Schedule this month again',
        }),
      );

      const dialog = screen.getByRole('dialog');
      const select = within(dialog).getByLabelText('Inspector');
      await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
      fireEvent.change(select, { target: { value: CANDIDATE } });

      fireEvent.click(
        within(dialog).getByRole('button', { name: /Schedule this month again/ }),
      );

      await waitFor(() => {
        expect(createScheduledInspection).toHaveBeenCalledWith({
          site_id: SITE,
          template_id: TEMPLATE,
          period_start: '2026-08-01',
          inspector_id: CANDIDATE,
        });
      });
    });

    it('el diálogo avisa que la cancelación queda igual', async () => {
      renderRoute();

      fireEvent.click(
        within(await openPeriodMenu()).getByRole('menuitem', {
          name: 'Schedule this month again',
        }),
      );

      expect(screen.getByText(/cancellation stays on the record/)).toBeTruthy();
    });

    it('no ofrece asignar ni cancelar sobre lo que ya está cancelado', async () => {
      renderRoute();

      const menu = await openPeriodMenu();

      expect(menu.textContent).toBe('Schedule this month again');
      expect(screen.queryByRole('menuitem', { name: 'Cancel this period' })).toBeNull();
      expect(screen.queryByLabelText('Assign')).toBeNull();
    });

    it('un jhsc_member lo lee cancelado y no tiene menú', async () => {
      useAppSession.mockReturnValue(session('jhsc_member'));

      renderRoute();

      expect(await screen.findByText('Cancelled: Plant shutdown')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    });
  });
});

/**
 * Reprogramar un mes que ya cerró devuelve una fila `missed` —el estado lo deriva el
 * servidor de la fecha, no de una decisión—, y sin explicación eso se lee como que
 * reprogramar no sirvió de nada.
 */
describe('el mes omitido', () => {
  it('dice que igual se puede enviar', async () => {
    listScheduled.mockResolvedValue([
      inspection({ status: 'missed', inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' }),
    ]);

    renderRoute();

    expect(await screen.findByText(/It can still be submitted/)).toBeTruthy();
  });

  it('sin inspector, dice que primero hay que asignarlo', async () => {
    listScheduled.mockResolvedValue([inspection({ status: 'missed' })]);

    renderRoute();

    expect(await screen.findByText(/Assign an inspector/)).toBeTruthy();
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

describe('el calendario del año', () => {
  it('el año en curso muestra doce meses, once de ellos sin abrir', async () => {
    renderRoute();

    await screen.findByText('August');
    expect(
      screen.getAllByText('Not opened yet', { selector: '.status-pill' }).length,
    ).toBe(11);
  });

  it('la flecha adelante lleva a un año entero sin abrir', async () => {
    renderRoute();

    const heading = await screen.findByRole('heading', { level: 3 });
    const currentYear = Number(heading.textContent);

    fireEvent.click(screen.getByRole('button', { name: `${currentYear + 1} →` }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(String(currentYear + 1));
    });
    expect(
      screen.getAllByText('Not opened yet', { selector: '.status-pill' }).length,
    ).toBe(12);
  });

  it('abrir un mes futuro desde su casilla lo programa con el inspector elegido', async () => {
    renderRoute();

    const heading = await screen.findByRole('heading', { level: 3 });
    const currentYear = Number(heading.textContent);
    const nextYear = currentYear + 1;

    fireEvent.click(screen.getByRole('button', { name: `${nextYear} →` }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(String(nextYear));
    });

    const decemberRow = (await screen.findByText('December')).closest('li');
    if (!decemberRow) throw new Error('no se encontró la fila de diciembre');

    const select = within(decemberRow).getByLabelText('Inspector');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });

    fireEvent.click(within(decemberRow).getByRole('button', { name: /Open this month/ }));

    await waitFor(() => {
      expect(createScheduledInspection).toHaveBeenCalledWith({
        site_id: SITE,
        template_id: TEMPLATE,
        period_start: `${nextYear}-12-01`,
        inspector_id: CANDIDATE,
      });
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

    // El selector de la fila es el que muestra al inspector asignado, con su número.
    const select = await screen.findByLabelText('Assign');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });

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

/**
 * La baja de una planta no la saca de `user_site_scope`, así que sigue llegando en el
 * alcance y en `GET /sites`. Si la consola no filtra, abre en un calendario vacío que
 * además se puede volver a elegir.
 */
describe('las plantas dadas de baja', () => {
  const glencoe: Site = { id: OTHER_SITE, code: 'glencoe', name: 'Glencoe', deactivated_at: null };
  const rodney: Site = {
    id: CLOSED_SITE,
    code: 'rodney',
    name: 'Rodney',
    deactivated_at: '2026-08-21T12:00:00.000Z',
  };

  it('no se ofrecen en el selector', async () => {
    listSites.mockResolvedValue([site(), glencoe, rodney]);
    useAppSession.mockReturnValue(session('hs_coordinator', [SITE, OTHER_SITE, CLOSED_SITE]));

    renderRoute();

    const select = await screen.findByLabelText('Site');
    expect(within(select).queryByRole('option', { name: /Rodney/ })).toBeNull();
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Glencoe',
      'St. Thomas',
    ]);
  });

  it('la consola no abre en una cerrada aunque encabece el alcance', async () => {
    listSites.mockResolvedValue([rodney, glencoe]);
    useAppSession.mockReturnValue(session('hs_coordinator', [CLOSED_SITE, OTHER_SITE]));
    listSchedules.mockResolvedValue([rule({ site_id: OTHER_SITE })]);

    renderRoute();

    // Una sola planta elegible: el selector degrada a texto, y dice cuál.
    expect(await screen.findByText('Site: Glencoe')).toBeTruthy();
    expect(screen.getAllByText('Monthly general workplace inspection').length).toBeGreaterThan(0);
  });

  it('sin ninguna planta activa lo dice, en vez de dibujar el año de una que no existe', async () => {
    listSites.mockResolvedValue([rodney]);
    useAppSession.mockReturnValue(session('hs_coordinator', [CLOSED_SITE]));

    renderRoute();

    expect(await screen.findByText('No active sites.')).toBeTruthy();
    expect(screen.queryByLabelText('Site')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull();
    expect(screen.queryByText('August')).toBeNull();
  });
});
