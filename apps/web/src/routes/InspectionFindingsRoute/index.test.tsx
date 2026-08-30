import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ActionSummary, PersonWithAccount, Session } from '@hs/contracts';

import { InspectionFindingsRoute } from './index';

const getSubmittedInspection = vi.hoisted(() => vi.fn());
const listActions = vi.hoisted(() => vi.fn());
const getAction = vi.hoisted(() => vi.fn());
const createAction = vi.hoisted(() => vi.fn());
const transitionAction = vi.hoisted(() => vi.fn());
const amendAssignment = vi.hoisted(() => vi.fn());
const uploadEvidence = vi.hoisted(() => vi.fn());
const listFindingRoster = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ getSubmittedInspection }));
vi.mock('../../api/actions', () => ({
  listActions,
  getAction,
  createAction,
  transitionAction,
  amendAssignment,
  uploadEvidence,
}));
vi.mock('../../api/findings', () => ({ listFindingRoster }));
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

/** Una enmienda del compromiso, como versión del historial (ADR-018). */
function commitment(position: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-00000000000${position}`,
    position,
    assignee_person_id: PERSON,
    assignee_name: 'Ada Reid',
    description: 'Refit the guard on packaging line 3',
    due_at: '2027-08-30T16:00:00.000Z',
    actor_user_id: '88888888-8888-4888-8888-888888888888',
    occurred_at: '2027-08-05T09:00:00.000Z',
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
    state: 'raised',
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
  getAction.mockResolvedValue(actionDetail());
  listFindingRoster.mockResolvedValue([person()]);
  createAction.mockResolvedValue({});
  transitionAction.mockResolvedValue(actionDetail({ state: 'in_progress' }));
  amendAssignment.mockResolvedValue(actionDetail());
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

/**
 * DÓNDE ESTÁ EL HALLAZGO, que no es lo mismo que qué etapa se está leyendo: `aria-current`
 * vive en la pestaña de la etapa vigente y no se mueve al abrir una pasada (`aria-selected`).
 */
function expectCurrentStage(name: string): void {
  const lifecycle = screen.getByRole('region', { name: 'Finding lifecycle' });
  expect(
    within(lifecycle).getByText(name).closest('[role="tab"]')?.getAttribute('aria-current'),
  ).toBe('step');
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

describe('InspectionFindingsRoute — ciclo del hallazgo', () => {
  beforeEach(() => {
    getSubmittedInspection.mockResolvedValue(report());
  });

  it('presenta raised y sin plazo cuando todavía no hay acciones', async () => {
    renderRoute();

    await screen.findByRole('region', { name: 'Finding lifecycle' });
    expectCurrentStage('Raised');
    expect(screen.queryByText(/day(?:s)? overdue|in \d+ day/)).toBeNull();
  });

  it('deja que la acción menos avanzada mande aunque otra esté cerrada', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([
      action({ state: 'closed' }),
      action({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', state: 'open' }),
    ]);

    renderRoute();

    await screen.findByRole('region', { name: 'Finding lifecycle' });
    expectCurrentStage('Assigned');
  });

  it('presenta closed solo cuando todas las acciones están cerradas', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'closed' })] }),
    );
    listActions.mockResolvedValue([
      action({ state: 'closed' }),
      action({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', state: 'closed' }),
    ]);

    renderRoute();

    await screen.findByRole('region', { name: 'Finding lifecycle' });
    expectCurrentStage('Closed');
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
  });

  it('ofrece al coordinador asignar el hallazgo levantado', async () => {
    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Create corrective action' })).toBeTruthy();
    expect(within(next).getByText(/Assign a responsible person/)).toBeTruthy();
  });

  /** ADR-017: quien reportó el hallazgo lo abre, aunque no sea el coordinador. */
  it('ofrece también a quien reportó el hallazgo, sin ser coordinador', async () => {
    useAppSession.mockReturnValue({ account: session('jhsc_member') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Create corrective action' })).toBeTruthy();
  });

  it('no ofrece la creación a un jhsc_member que no reportó el hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ reported_by: '77777777-7777-4777-8777-777777777777' })] }),
    );
    useAppSession.mockReturnValue({ account: session('jhsc_member') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).queryByRole('button', { name: 'Create corrective action' })).toBeNull();
  });

  it('ofrece al responsable empezar el trabajo', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
    useAppSession.mockReturnValue({ account: session('external_auditor') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Start work' })).toBeTruthy();
  });

  it('ofrece la verificación al supervisor', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'verification' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'awaiting_verification' })]);
    useAppSession.mockReturnValue({ account: session('supervisor') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Verify and close' })).toBeTruthy();
  });

  it('el lector sin permiso ve a quién espera y ningún control principal', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'in_progress' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'in_progress' })]);
    useAppSession.mockReturnValue({
      account: { ...session('jhsc_member'), personId: '77777777-7777-4777-8777-777777777777' },
    });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByText('Ada Reid')).toBeTruthy();
    expect(within(next).queryByRole('button')).toBeNull();
  });
});

/**
 * El camino del hallazgo a la obligación, que antes vivía en `/actions`.
 *
 * Se prueba desde acá porque acá es donde se decide: el coordinador ve la pregunta, lo que
 * la plantilla prescribió y lo que el inspector observó, y recién entonces se compromete.
 */
describe('InspectionFindingsRoute — el compromiso', () => {
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
    expect(screen.getByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expectCurrentStage('Raised');
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
  });

  it('crea la acción sobre el hallazgo de esa pregunta y con el roster de ese hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    submit(dialog);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(listFindingRoster).toHaveBeenCalledWith(FINDING);
    expect(createAction).toHaveBeenCalledWith(FINDING, {
      assignee_person_id: PERSON,
      description: 'Install a fixed guard before restarting the line',
      due_at: new Date('2099-08-30T12:00').toISOString(),
    });
  });

  it('cierra el diálogo y muestra la acción recién creada', async () => {
    let reads = 0;
    let findingReads = 0;
    getSubmittedInspection.mockImplementation(() => {
      findingReads += 1;
      return Promise.resolve(
        report({ findings: [finding({ state: findingReads === 1 ? 'raised' : 'assigned' })] }),
      );
    });
    listActions.mockImplementation(() => {
      reads += 1;
      return Promise.resolve(reads === 1 ? [] : [action()]);
    });

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    submit(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Start work' })).toBeTruthy();
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
    listFindingRoster.mockRejectedValue(new Error('offline'));

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
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
  });

  /** El paso se ejecuta en la ficha; no hay diálogo que esperar ni nada que desplegar. */
  async function submitStep(name: string): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name }));
  }

  it('el responsable registra progreso sin salir de la lectura del hallazgo', async () => {
    let reads = 0;
    let findingReads = 0;
    getSubmittedInspection.mockImplementation(() => {
      findingReads += 1;
      return Promise.resolve(
        report({
          findings: [finding({ state: findingReads === 1 ? 'assigned' : 'in_progress' })],
        }),
      );
    });
    listActions.mockImplementation(() => {
      reads += 1;
      return Promise.resolve([action(reads === 1 ? {} : { state: 'in_progress' })]);
    });
    useAppSession.mockReturnValue({ account: session('external_auditor') });

    renderRoute();
    await submitStep('Start work');

    await waitFor(() => expect(transitionAction).toHaveBeenCalledWith(action().id, {
      to: 'in_progress',
      note: undefined,
      reason: undefined,
      evidence: [],
    }));
    // La lectura del hallazgo sigue en pantalla: la pregunta que lo abrió no se fue.
    expect(screen.getByText('Machine guards in place')).toBeTruthy();
    await waitFor(() => expectCurrentStage('In progress'));
    expect(await screen.findByRole('button', { name: 'Declare the work done' })).toBeTruthy();
  });

  it('ofrece evidencia posterior sin exigirla para declarar el trabajo terminado', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'in_progress' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'in_progress' })]);

    renderRoute();

    expect(await screen.findByText('Add after photos')).toBeTruthy();
    await submitStep('Declare the work done');

    await waitFor(() => expect(transitionAction).toHaveBeenCalledWith(action().id, {
      to: 'awaiting_verification',
      note: undefined,
      reason: undefined,
      evidence: [],
    }));
  });

  /**
   * El paso se ejecuta con una sola pulsación: los campos y el botón de la transición están
   * dibujados desde que se lee el hallazgo. Nada revela el formulario, así que tampoco hay
   * nada que replegar.
   */
  it('dibuja los campos del paso sin pulsar nada, y no ofrece un control que lo pliegue', async () => {
    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByLabelText(/Note/)).toBeTruthy();
    expect(within(next).getByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(transitionAction).not.toHaveBeenCalled();
  });

  it('una acción cerrada no ofrece ningún paso', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'closed' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'closed' })]);

    renderRoute();

    await screen.findByText('Machine guards in place');
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
  });

  it('muestra el rechazo del servidor y conserva el estado anterior', async () => {
    transitionAction.mockRejectedValue(new Error('The verifier cannot be the executor.'));

    renderRoute();
    await submitStep('Start work');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The verifier cannot be the executor.',
    );
    // El estado anterior se conserva: la etapa no avanzó y el paso ofrecido es el mismo.
    expectCurrentStage('Assigned');
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
  });
});

describe('InspectionFindingsRoute — Edit assignment (ADR-018)', () => {
  beforeEach(() => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
  });

  it('el coordinador corrige responsable, trabajo y plazo sin salir de la ficha', async () => {
    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    fireEvent.click(within(next).getByRole('button', { name: 'Edit assignment' }));

    const form = within(next).getByRole('form', { name: 'Edit assignment' });
    await within(form).findByRole('option', { name: /\([0-9]+\)$/ });

    // Precargado con el compromiso vigente.
    expect((within(form).getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Refit the guard on packaging line 3',
    );

    fireEvent.change(within(form).getByLabelText('Description'), {
      target: { value: 'Install an interlocked guard and update the lockout procedure' },
    });
    fireEvent.change(within(form).getByLabelText('Deadline'), {
      target: { value: '2099-09-01T12:00' },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(amendAssignment).toHaveBeenCalledWith(action().id, {
        assignee_person_id: PERSON,
        description: 'Install an interlocked guard and update the lockout procedure',
        due_at: new Date('2099-09-01T12:00').toISOString(),
      }),
    );
    // El hallazgo sigue en Assigned y Start work sigue ofreciéndose.
    expectCurrentStage('Assigned');
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
  });

  it('conserva lo escrito cuando el servidor rechaza la enmienda', async () => {
    amendAssignment.mockRejectedValue(new Error('The assignment can only be amended before the work starts'));

    renderRoute();
    const next = await screen.findByRole('region', { name: 'Next step' });
    fireEvent.click(within(next).getByRole('button', { name: 'Edit assignment' }));
    const form = within(next).getByRole('form', { name: 'Edit assignment' });
    await within(form).findByRole('option', { name: /\([0-9]+\)$/ });

    fireEvent.change(within(form).getByLabelText('Description'), {
      target: { value: 'A corrected description that the server will reject here' },
    });
    fireEvent.submit(form);

    expect((await within(form).findByRole('alert')).textContent).toContain('can only be amended');
    expect((within(form).getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'A corrected description that the server will reject here',
    );
  });

  it('no ofrece Edit assignment a quien no reportó el hallazgo ni es coordinador', async () => {
    useAppSession.mockReturnValue({ account: session('supervisor') });
    getSubmittedInspection.mockResolvedValue(
      report({
        findings: [
          finding({ state: 'assigned', reported_by: '11111111-1111-4111-8111-111111111111' }),
        ],
      }),
    );

    renderRoute();

    await screen.findByRole('region', { name: 'Next step' });
    expect(screen.queryByRole('button', { name: 'Edit assignment' })).toBeNull();
  });

  it('retira Edit assignment en cuanto el trabajo empezó', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'in_progress' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'in_progress' })]);

    renderRoute();

    await screen.findByRole('region', { name: 'Next step' });
    expect(screen.queryByRole('button', { name: 'Edit assignment' })).toBeNull();
  });

  it('presenta el compromiso original y la enmienda en el registro de la etapa', async () => {
    getAction.mockResolvedValue(
      actionDetail({
        commitments: [
          commitment(0, { description: 'Refit the guard on packaging line 3' }),
          commitment(1, { description: 'Install an interlocked guard instead' }),
        ],
      }),
    );

    renderRoute();

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    const versions = within(record).getAllByRole('listitem');
    expect(versions[0]?.textContent).toContain('Original commitment');
    expect(versions[0]?.textContent).toContain('Refit the guard on packaging line 3');
    expect(versions[1]?.textContent).toContain('Amendment 1');
    expect(versions[1]?.textContent).toContain('Install an interlocked guard instead');
  });

  /**
   * El registro contesta una pregunta que alguien hizo —abrir la etapa—, así que contesta
   * también cuando la respuesta es "se prometió esto y nada más". Antes se callaba sin
   * enmiendas, cuando aparecía solo y sin que nadie lo pidiera.
   */
  it('muestra el compromiso original aunque no haya habido enmiendas', async () => {
    renderRoute();

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Original commitment')).toBeTruthy();
    expect(within(record).queryByText('Amendment 1')).toBeNull();
  });
});

/**
 * LA ETAPA ALCANZADA ES EL CONTROL. Leer qué pasó en una etapa anterior no es irse a otra
 * pantalla ni mover el hallazgo: la ficha se queda, `aria-current` se queda, y lo único que
 * cambia es qué contesta el panel.
 */
describe('InspectionFindingsRoute — navegación entre etapas', () => {
  /** El stream completo de una acción que fue devuelta una vez y terminó cerrada. */
  function history(): Action {
    return actionDetail({
      state: 'closed',
      events: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000000',
          position: 0,
          from_state: null,
          to_state: 'open',
          actor_user_id: '88888888-8888-4888-8888-888888888888',
          note: null,
          reason: null,
          occurred_at: '2027-08-01T12:00:00.000Z',
          recorded_at: '2027-08-01T12:00:01.000Z',
          evidence: [],
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
          position: 1,
          from_state: 'open',
          to_state: 'in_progress',
          actor_user_id: PERSON,
          note: null,
          reason: null,
          occurred_at: '2027-08-02T12:00:00.000Z',
          recorded_at: '2027-08-02T12:00:01.000Z',
          evidence: [],
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000002',
          position: 2,
          from_state: 'in_progress',
          to_state: 'awaiting_verification',
          actor_user_id: PERSON,
          note: 'Guard refitted on the infeed.',
          reason: null,
          occurred_at: '2027-08-03T12:00:00.000Z',
          recorded_at: '2027-08-03T12:00:01.000Z',
          evidence: [
            {
              id: 'eeeeeeee-eeee-4eee-8eee-000000000000',
              kind: 'before',
              object_key: 'actions/before.jpg',
              created_at: '2027-08-03T12:00:00.000Z',
            },
            {
              id: 'eeeeeeee-eeee-4eee-8eee-000000000001',
              kind: 'after',
              object_key: 'actions/after.jpg',
              created_at: '2027-08-03T12:00:00.000Z',
            },
          ],
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000003',
          position: 3,
          from_state: 'awaiting_verification',
          to_state: 'in_progress',
          actor_user_id: '88888888-8888-4888-8888-888888888888',
          note: null,
          reason: 'The guard is not interlocked yet.',
          occurred_at: '2027-08-04T12:00:00.000Z',
          recorded_at: '2027-08-04T12:00:01.000Z',
          evidence: [],
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000004',
          position: 4,
          from_state: 'awaiting_verification',
          to_state: 'closed',
          actor_user_id: '88888888-8888-4888-8888-888888888888',
          note: 'Verified on the floor.',
          reason: null,
          occurred_at: '2027-08-05T12:00:00.000Z',
          recorded_at: '2027-08-05T12:00:01.000Z',
          evidence: [],
        },
      ],
    });
  }

  beforeEach(() => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'closed' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'closed' })]);
    getAction.mockResolvedValue(history());
  });

  /** Una etapa por delante no está vacía: no ocurrió, y ofrecerla prometería una lectura. */
  it('no ofrece como pestaña la etapa que el hallazgo todavía no alcanzó', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByRole('tab', { name: 'Raised' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assigned' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Verification' })).toBeNull();
    // Sigue escrita: el ciclo entero, no el recorrido hecho.
    expect(screen.getByText('Verification')).toBeTruthy();
  });

  it('abre el registro de una etapa pasada sin mover el hallazgo', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Assigned' }));

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Original commitment')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assigned' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // Dónde está el hallazgo no cambió por leer otra etapa.
    expectCurrentStage('Closed');
  });

  /** El PAR y no el destino: "Send it back" y "Start work" llegan al mismo estado. */
  it('nombra cada evento por la transición que alguien pulsó', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'In progress' }));

    const record = await screen.findByRole('region', { name: 'In progress record' });
    expect(within(record).getByText('Start work')).toBeTruthy();
    expect(within(record).getByText('Send it back')).toBeTruthy();
    expect(within(record).getByText('The guard is not interlocked yet.')).toBeTruthy();
  });

  it('cuenta la evidencia y conserva la nota de la etapa de verificación', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Verification' }));

    const record = await screen.findByRole('region', { name: 'Verification record' });
    expect(within(record).getByText('Guard refitted on the infeed.')).toBeTruthy();
    expect(within(record).getByText(/1 before, 1 after/)).toBeTruthy();
    // El cierre es otra etapa y no se cuela en esta.
    expect(within(record).queryByText('Verified on the floor.')).toBeNull();
  });

  it('la etapa levantada se lee sin consultar ninguna acción', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Raised' }));

    const record = await screen.findByRole('region', { name: 'Raised record' });
    expect(within(record).getByText('Reported')).toBeTruthy();
    expect(within(record).getByText('Photos')).toBeTruthy();
  });

  it('las flechas recorren las etapas alcanzadas', async () => {
    renderRoute();

    const tabs = await screen.findByRole('tablist');
    fireEvent.keyDown(tabs, { key: 'Home' });

    expect(await screen.findByRole('region', { name: 'Raised record' })).toBeTruthy();

    fireEvent.keyDown(tabs, { key: 'ArrowRight' });
    expect(await screen.findByRole('region', { name: 'Assigned record' })).toBeTruthy();
  });

  /** Con un borrador abierto, cambiar de panel se llevaría puesto lo escrito. */
  it('no deja elegir otra etapa mientras la enmienda está abierta', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
    getAction.mockResolvedValue(actionDetail());

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect((screen.getByRole('tab', { name: 'Raised' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(within(next).getByRole('button', { name: 'Edit assignment' }));
    expect((screen.getByRole('tab', { name: 'Raised' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('tab', { name: 'Raised' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  /**
   * Avanzar mueve la lectura con el hallazgo: sin eso, la etapa elegida se quedaría en la
   * que acaba de terminar y la ficha mostraría un registro viejo —y ningún paso— justo en el
   * momento en que hay que ver qué sigue.
   */
  it('vuelve a la etapa vigente cuando el hallazgo avanza', async () => {
    let findingReads = 0;
    getSubmittedInspection.mockImplementation(() => {
      findingReads += 1;
      return Promise.resolve(
        report({
          findings: [finding({ state: findingReads === 1 ? 'assigned' : 'in_progress' })],
        }),
      );
    });
    let reads = 0;
    listActions.mockImplementation(() => {
      reads += 1;
      return Promise.resolve([action(reads === 1 ? {} : { state: 'in_progress' })]);
    });
    getAction.mockResolvedValue(actionDetail());
    useAppSession.mockReturnValue({ account: session('external_auditor') });

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Start work' }));

    await waitFor(() => expectCurrentStage('In progress'));
    expect(
      screen.getByRole('tab', { name: 'In progress' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(await screen.findByRole('region', { name: 'Next step' })).toBeTruthy();
  });
});
