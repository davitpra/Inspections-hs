import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ActionSummary, PersonWithAccount, Session } from '@hs/contracts';

import { InspectionFindingsRoute } from './index';

const getSubmittedInspection = vi.hoisted(() => vi.fn());
const listActions = vi.hoisted(() => vi.fn());
const createAction = vi.hoisted(() => vi.fn());
const getAction = vi.hoisted(() => vi.fn());
const transitionAction = vi.hoisted(() => vi.fn());
const uploadEvidence = vi.hoisted(() => vi.fn());
const listPeople = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ getSubmittedInspection }));
vi.mock('../../api/actions', () => ({
  listActions,
  createAction,
  getAction,
  transitionAction,
  uploadEvidence,
}));
vi.mock('../../api/roster', () => ({ listPeople }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: INSPECTION }),
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  }) => <a href={substitute(to, params)}>{children}</a>,
}));

function substitute(to: string, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce(
    (path, [name, value]) => path.replace(`$${name}`, value),
    to,
  );
}

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const SUBMISSION = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
const FINDING = '55555555-5555-4555-8555-555555555555';
const PERSON = '99999999-9999-4999-8999-999999999999';

function action(overrides: Partial<ActionSummary> = {}): ActionSummary {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    site_id: SITE,
    site_name: 'St. Thomas',
    assignee_person_id: PERSON,
    assignee_name: 'Ada Reid',
    description: 'Refit the guard on packaging line 3',
    due_at: '2027-08-30T16:00:00.000Z',
    state: 'open',
    overdue: false,
    escalations: [],
    source: {
      kind: 'inspection',
      finding_id: FINDING,
      inspection_id: SUBMISSION,
      scheduled_inspection_id: INSPECTION,
      template_id: '44444444-4444-4444-8444-444444444444',
      template_name: 'Monthly general workplace inspection',
    },
    ...overrides,
  };
}

function actionDetail(overrides: Partial<Action> = {}): Action {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    site_id: SITE,
    finding_id: FINDING,
    investigation_id: null,
    assignee_person_id: PERSON,
    description: 'Refit the guard on packaging line 3',
    due_at: '2027-08-30T16:00:00.000Z',
    remediation_group_id: null,
    created_by: '88888888-8888-4888-8888-888888888888',
    created_at: '2027-08-01T12:00:00.000Z',
    state: 'open',
    overdue: false,
    events: [
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        position: 0,
        from_state: null,
        to_state: 'open',
        actor_user_id: '88888888-8888-4888-8888-888888888888',
        note: 'Guard replacement approved.',
        reason: null,
        occurred_at: '2027-08-01T12:00:00.000Z',
        recorded_at: '2027-08-01T12:00:01.000Z',
        evidence: [],
      },
    ],
    escalations: [],
    ...overrides,
  };
}

function person(overrides: Partial<PersonWithAccount> = {}): PersonWithAccount {
  return {
    id: PERSON,
    site_id: SITE,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
    account: null,
    ...overrides,
  };
}

function session(role: Session['role']): Session {
  return {
    userId: '88888888-8888-4888-8888-888888888888',
    personId: PERSON,
    role,
    siteScope: [SITE],
    recordsFrom: null,
    recordsTo: null,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    site_id: SITE,
    origin: 'inspection',
    inspection_id: SUBMISSION,
    template_version_item_id: '66666666-6666-4666-8666-666666666666',
    item_key: 'general.guards',
    location_id: null,
    description: 'Guard missing on the infeed of packaging line 3',
    photo_object_keys: ['site/finding.jpg'],
    reported_by: '88888888-8888-4888-8888-888888888888',
    occurred_at: '2027-07-29T18:00:00.000Z',
    recorded_at: '2027-07-29T18:05:00.000Z',
    ...overrides,
  };
}

/**
 * Dos secciones. En la primera, una pregunta con hallazgo y otra limpia; la segunda entera
 * sin nada. Es el documento que distingue esta pantalla del reporte completo.
 */
function report(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_inspection_id: INSPECTION,
    inspection_id: SUBMISSION,
    site_id: SITE,
    period_start: '2027-07-01',
    period_months: 1,
    template_name: 'Monthly general workplace inspection',
    template_version_id: '44444444-4444-4444-8444-444444444444',
    template_version: 2,
    document: {
      sections: [
        {
          section_key: 'general',
          section_title: 'Work areas and housekeeping',
          position: 1,
          items: [
            {
              item_key: 'general.guards',
              prompt: 'Machine guards in place',
              position: 1,
              required: true,
              response_type: 'yes_no',
              finding: { corrective_action: 'Refit the guard before the line runs again.' },
            },
            {
              item_key: 'general.aisles',
              prompt: 'Aisles kept clear',
              position: 2,
              required: true,
              response_type: 'yes_no',
            },
          ],
        },
        {
          section_key: 'exits',
          section_title: 'Emergency exits',
          position: 2,
          items: [
            {
              item_key: 'exits.lit',
              prompt: 'Exit signs lit',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
          ],
        },
      ],
    },
    answers: {
      'general.guards': false,
      'general.aisles': true,
      'exits.lit': true,
    },
    findings: [finding()],
    submitted_by: '88888888-8888-4888-8888-888888888888',
    submitted_by_name: 'Marie Tremblay',
    signed_at: '2027-07-29T18:00:00.000Z',
    received_at: '2027-08-02T13:00:00.000Z',
    answer_count: 3,
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <InspectionFindingsRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  listActions.mockResolvedValue([]);
  listPeople.mockResolvedValue([person()]);
  createAction.mockResolvedValue({});
  getAction.mockResolvedValue(actionDetail());
  transitionAction.mockResolvedValue(actionDetail({ state: 'in_progress' }));
  uploadEvidence.mockResolvedValue('actions/evidence.jpg');
  useAppSession.mockReturnValue({ account: session('hs_coordinator') });
});

async function openCreation(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Create corrective action' }));
  return await screen.findByRole('dialog', { name: 'Create corrective action' });
}

async function completeForm(dialog: HTMLElement, assignee = PERSON): Promise<void> {
  await within(dialog).findByRole('option', { name: /\([0-9]+\)$/ });
  fireEvent.change(within(dialog).getByLabelText('Assignee'), { target: { value: assignee } });
  fireEvent.change(within(dialog).getByLabelText('Description'), {
    target: { value: 'Install a fixed guard before restarting the line' },
  });
  fireEvent.change(within(dialog).getByLabelText('Deadline'), {
    target: { value: '2099-08-30T12:00' },
  });
}

function submit(dialog: HTMLElement): void {
  fireEvent.submit(
    within(dialog).getByRole('button', { name: 'Create action' }).closest('form')!,
  );
}

describe('InspectionFindingsRoute', () => {
  /** LA aserción de esta pantalla: la pregunta que falló está, la que pasó no. */
  it('muestra la pregunta que abrió un hallazgo y no la que quedó limpia', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('Machine guards in place')).toBeTruthy();
    expect(screen.queryByText('Aisles kept clear')).toBeNull();
  });

  it('omite entera la sección que no dejó ningún hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    await screen.findByText('Work areas and housekeeping');
    expect(screen.queryByText('Emergency exits')).toBeNull();
    expect(screen.queryByText('Exit signs lit')).toBeNull();
  });

  /** El hallazgo sin la pregunta que lo abrió sería una queja suelta. */
  it('dibuja el hallazgo junto a la respuesta que lo abrió', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(
      await screen.findByText('Guard missing on the infeed of packaging line 3'),
    ).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('1 photo')).toBeTruthy();
  });

  /**
   * Lo prescrito y lo observado son dos cosas distintas y la pantalla las dice las dos: lo
   * que la plantilla decidió hace meses, y lo que el inspector vio ese día. Un hallazgo sin
   * la acción correctiva prescrita obliga a ir a buscar la plantilla publicada para saber
   * qué había que hacer.
   */
  it('lee la acción correctiva que la plantilla prescribió para el ítem', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('Corrective action')).toBeTruthy();
    expect(screen.getByText('Refit the guard before the line runs again.')).toBeTruthy();
  });

  /**
   * Se dice que esto es un recorte y se ofrece el entero. Sin eso, las preguntas que
   * faltan se leerían como preguntas sin contestar.
   */
  it('ofrece el recorrido completo del mismo envío', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const full = await screen.findByRole('link', { name: 'Read the full inspection' });
    expect(full.getAttribute('href')).toBe(`/inspections/${INSPECTION}/report`);
  });

  /**
   * Una inspección limpia se alcanza por URL escrita a mano. Dejar el encabezado solo se
   * leería como una pantalla rota en vez de como una buena noticia.
   */
  it('lo dice cuando la inspección se cerró sin hallazgos', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ answers: { 'general.guards': true, 'general.aisles': true, 'exits.lit': true }, findings: [] }),
    );

    renderRoute();

    expect(await screen.findByText(/This inspection recorded no findings/)).toBeTruthy();
    expect(screen.queryByText('Machine guards in place')).toBeNull();
  });

  it('sin red lo dice, y no finge una inspección limpia', async () => {
    getSubmittedInspection.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/This inspection could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/recorded no findings/)).toBeNull();
  });
});

/**
 * El camino del hallazgo a la obligación, que antes vivía en `/actions`.
 *
 * Se prueba desde acá porque acá es donde se decide: el coordinador ve la pregunta, lo que
 * la plantilla prescribió y lo que el inspector observó, y recién entonces se compromete.
 */
describe('InspectionFindingsRoute — el compromiso', () => {
  it('ofrece crear una acción al coordinador y no al resto', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();
    expect(await screen.findByRole('button', { name: 'Create corrective action' })).toBeTruthy();

    cleanup();
    useAppSession.mockReturnValue({ account: session('jhsc_member') });
    listActions.mockResolvedValue([action()]);

    renderRoute();
    expect(await screen.findByText('Refit the guard on packaging line 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create corrective action' })).toBeNull();
  });

  /** Leer qué se comprometió no es privilegio de nadie, y sin eso se abren duplicados a ciegas. */
  it('lee las acciones que el hallazgo ya tiene, con su estado y su enlace', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockResolvedValue([
      action(),
      action({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        description: 'Retrain the line crew on guard checks',
        state: 'closed',
      }),
    ]);

    renderRoute();

    const link = await screen.findByRole('link', { name: 'Refit the guard on packaging line 3' });
    expect(link.getAttribute('href')).toBe('/actions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText('No corrective action yet.')).toBeNull();
  });

  it('lee responsable, plazo, atraso y escalamiento sin pedir el detalle', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockResolvedValue([
      action({
        state: 'in_progress',
        overdue: true,
        escalations: [
          {
            level: 'supervisor',
            days_overdue: 1,
            escalated_at: '2027-08-31T12:00:00.000Z',
          },
        ],
      }),
    ]);

    renderRoute();

    expect(await screen.findByText('Ada Reid')).toBeTruthy();
    expect(screen.getByText('2027-08-30')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText(/Sent to supervisor \(1 days late\)/)).toBeTruthy();
    expect(getAction).not.toHaveBeenCalled();
  });

  it('deja de lado la acción de otro hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockResolvedValue([
      action({ source: { kind: 'manual_finding', finding_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }),
    ]);

    renderRoute();

    expect(await screen.findByText('No corrective action yet.')).toBeTruthy();
  });

  /**
   * CERO NO SE AFIRMA SIN HABER LEÍDO. Con la lista de acciones caída, "no corrective action
   * yet" tendría la misma cara que la verdad y el coordinador abriría un duplicado.
   */
  it('no declara un hallazgo sin acciones cuando no pudo leerlas', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(
      await screen.findByText('Existing corrective actions need a connection.'),
    ).toBeTruthy();
    expect(screen.queryByText('No corrective action yet.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create corrective action' })).toBeTruthy();
  });

  it('crea la acción sobre el hallazgo de esa pregunta y con el roster de su sitio', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    submit(dialog);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(listPeople).toHaveBeenCalledWith(SITE);
    expect(createAction).toHaveBeenCalledWith(FINDING, {
      assignee_person_id: PERSON,
      description: 'Install a fixed guard before restarting the line',
      due_at: new Date('2099-08-30T12:00').toISOString(),
    });
  });

  it('cierra el diálogo y muestra la acción recién creada', async () => {
    let reads = 0;
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockImplementation(() => {
      reads += 1;
      return Promise.resolve(reads === 1 ? [] : [action()]);
    });

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    submit(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByRole('link', { name: 'Refit the guard on packaging line 3' }),
    ).toBeTruthy();
  });

  it('no envía un plazo que no es futuro', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    fireEvent.change(within(dialog).getByLabelText('Deadline'), {
      target: { value: '2000-01-01T12:00' },
    });
    submit(dialog);

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Deadline must be in the future.',
    );
    expect(createAction).not.toHaveBeenCalled();
  });

  it('no envía dos veces mientras la creación está pendiente', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    createAction.mockReturnValue(new Promise(() => undefined));

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);

    // El formulario se toma UNA vez: al enviar, el botón pasa a decir «Creating…» y
    // buscarlo por su nombre anterior no encontraría nada.
    const form = within(dialog).getByRole('button', { name: 'Create action' }).closest('form')!;
    fireEvent.submit(form);
    expect(
      ((await within(dialog).findByRole('button', { name: 'Creating…' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(form);

    expect(createAction).toHaveBeenCalledTimes(1);
  });

  it('muestra el rechazo y conserva todos los campos del borrador', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    createAction.mockRejectedValue(new Error('The server rejected this commitment.'));

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    submit(dialog);

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The server rejected this commitment.',
    );
    expect((within(dialog).getByLabelText('Assignee') as HTMLSelectElement).value).toBe(PERSON);
    expect((within(dialog).getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Install a fixed guard before restarting the line',
    );
    expect((within(dialog).getByLabelText('Deadline') as HTMLInputElement).value).toBe(
      '2099-08-30T12:00',
    );
  });

  it('limita un fallo del roster al formulario abierto', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listPeople.mockRejectedValue(new Error('offline'));

    renderRoute();

    const dialog = await openCreation();
    expect(
      await within(dialog).findByText('The active people for this site need a connection.'),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Create action' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Guard missing on the infeed of packaging line 3')).toBeTruthy();
  });
});

describe('InspectionFindingsRoute — avance de la acción', () => {
  beforeEach(() => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockResolvedValue([action()]);
  });

  async function openProgress(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));
    const dialog = await screen.findByRole('dialog', { name: 'Update corrective action' });
    await within(dialog).findByText('History');
    return dialog;
  }

  it('el responsable registra progreso sin salir de la lectura del hallazgo', async () => {
    let reads = 0;
    listActions.mockImplementation(() => {
      reads += 1;
      return Promise.resolve([action(reads === 1 ? {} : { state: 'in_progress' })]);
    });
    useAppSession.mockReturnValue({ account: session('external_auditor') });

    renderRoute();
    const dialog = await openProgress();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start work' }));

    await waitFor(() => expect(transitionAction).toHaveBeenCalledWith(action().id, {
      to: 'in_progress',
      note: undefined,
      reason: undefined,
      evidence: [],
    }));
    expect(screen.getByText('Machine guards in place')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('In progress')).toBeTruthy());
  });

  it('un miembro de JHSC lee los eventos en orden y espera a otra persona', async () => {
    useAppSession.mockReturnValue({
      account: {
        ...session('jhsc_member'),
        personId: '77777777-7777-4777-8777-777777777777',
      },
    });
    getAction.mockResolvedValue(actionDetail({
      events: [
        actionDetail().events[0]!,
        {
          ...actionDetail().events[0]!,
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          position: 1,
          from_state: 'open',
          to_state: 'in_progress',
          note: 'Work started.',
          occurred_at: '2027-08-02T13:30:00.000Z',
        },
        {
          ...actionDetail().events[0]!,
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          position: 2,
          from_state: 'in_progress',
          to_state: 'awaiting_verification',
          note: 'Ready to inspect.',
          occurred_at: '2027-08-03T14:45:00.000Z',
        },
      ],
    }));

    renderRoute();
    const dialog = await openProgress();

    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Guard replacement approved.'),
      expect.stringContaining('Work started.'),
      expect.stringContaining('Ready to inspect.'),
    ]);
    expect(within(dialog).getByText(/someone else has to move this one along/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Start work' })).toBeNull();
  });

  it('pide evidencia posterior antes de declarar el trabajo terminado', async () => {
    getAction.mockResolvedValue(actionDetail({ state: 'in_progress' }));

    renderRoute();
    const dialog = await openProgress();

    expect(within(dialog).getByText('Add after photos')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Declare the work done' })).toBeTruthy();
  });

  it('una acción cerrada conserva la historia y no ofrece reapertura', async () => {
    getAction.mockResolvedValue(actionDetail({ state: 'closed' }));

    renderRoute();
    const dialog = await openProgress();

    expect(within(dialog).getByText('Guard replacement approved.')).toBeTruthy();
    expect(within(dialog).getByText('Action closed')).toBeTruthy();
    expect(within(dialog).queryByText('What now')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /reopen/i })).toBeNull();
  });

  it('muestra el rechazo del servidor y conserva el estado anterior', async () => {
    transitionAction.mockRejectedValue(new Error('The verifier cannot be the executor.'));

    renderRoute();
    const dialog = await openProgress();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start work' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The verifier cannot be the executor.',
    );
    expect(screen.getAllByText('Open')).toHaveLength(2);
    expect(screen.queryByText('In progress')).toBeNull();
  });
});
