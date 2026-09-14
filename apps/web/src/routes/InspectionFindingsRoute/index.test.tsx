import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ActionSummary, PersonWithAccount, Session } from '@hs/contracts';

import { InspectionFindingsRoute } from './index';

const getSubmittedInspection = vi.hoisted(() => vi.fn());
const listActions = vi.hoisted(() => vi.fn());
const getAction = vi.hoisted(() => vi.fn());
const getEvidenceDownload = vi.hoisted(() => vi.fn());
const createAction = vi.hoisted(() => vi.fn());
const transitionAction = vi.hoisted(() => vi.fn());
const replaceAssignment = vi.hoisted(() => vi.fn());
const uploadEvidence = vi.hoisted(() => vi.fn());
const listFindingRoster = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ getSubmittedInspection }));
vi.mock('../../api/actions', () => ({
  listActions,
  getAction,
  getEvidenceDownload,
  createAction,
  transitionAction,
  replaceAssignment,
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
  getEvidenceDownload.mockImplementation((id: string) =>
    Promise.resolve({
      url: `https://bucket.test/${id}`,
      object_key: `actions/${id}.jpg`,
      expires_at: '2099-01-01T00:05:00.000Z',
    }),
  );
  listFindingRoster.mockResolvedValue([person()]);
  createAction.mockResolvedValue({});
  transitionAction.mockResolvedValue(actionDetail({ state: 'in_progress' }));
  replaceAssignment.mockResolvedValue(actionDetail());
  uploadEvidence.mockResolvedValue('actions/evidence.jpg');
  useAppSession.mockReturnValue({ account: session('coordinator') });
});

/**
 * El compromiso llega plegado detrás del control que lo nombra: un hallazgo levantado no tiene
 * ciclo que leer, y la pulsación es la que decide componerlo.
 */
async function creationForm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Create a follow-up' }));

  return await screen.findByRole('form', { name: 'Create follow-up' });
}

async function completeForm(form: HTMLElement, assignee = PERSON): Promise<void> {
  await within(form).findByRole('option', { name: /\([0-9]+\)$/ });
  fireEvent.change(within(form).getByLabelText('Responsible person'), {
    target: { value: assignee },
  });
  fireEvent.change(within(form).getByLabelText('Describe the follow-up'), {
    target: { value: 'Install a fixed guard before restarting the line' },
  });
  fireEvent.change(within(form).getByLabelText('Deadline'), {
    target: { value: '2099-08-30' },
  });
}

function submit(form: HTMLElement): void {
  fireEvent.submit(form);
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

    await creationForm();
    expectCurrentStage('Raised');
    expect(screen.queryByText(/day(?:s)? overdue|in \d+ day/)).toBeNull();
  });

  /**
   * EL ALTA SE LEE EN LA ETAPA QUE ESCRIBE, que es la única excepción: no hay ninguna etapa
   * anterior con algo decidido que el formulario esté tapando. `Assigned` sale vacía y lo dice,
   * y el indicador del ciclo no se mueve: el hallazgo sigue levantado hasta que se envíe.
   */
  it('abre la composición en la etapa que escribiría, marcada como no registrada', async () => {
    renderRoute();
    await creationForm();

    const next = screen.getByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('form', { name: 'Create follow-up' })).toBeTruthy();

    const assigned = screen.getByRole('tab', { name: 'Assigned' });
    expect(assigned.getAttribute('aria-selected')).toBe('true');
    expectCurrentStage('Raised');

    const record = screen.getByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText(/No follow-up has been created yet/)).toBeTruthy();
    expect(within(record).queryByText(/needs a connection/)).toBeNull();
  });

  /** Leer lo observado no descarta lo escrito: los tres campos viven fuera del panel. */
  it('ir a Raised y volver conserva la composición', async () => {
    renderRoute();

    const form = await creationForm();
    await completeForm(form);

    fireEvent.click(screen.getByRole('tab', { name: 'Raised' }));
    const record = screen.getByRole('region', { name: 'Raised record' });
    expect(within(record).getByText('Finding recorded date')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Assigned' }));
    const again = screen.getByRole('form', { name: 'Create follow-up' });
    expect((within(again).getByLabelText('Responsible person') as HTMLSelectElement).value).toBe(
      PERSON,
    );
    expect((within(again).getByLabelText('Deadline') as HTMLInputElement).value).toBe(
      '2099-08-30',
    );
    expect(createAction).not.toHaveBeenCalled();
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
    await creationForm();

    const next = screen.getByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('form', { name: 'Create follow-up' })).toBeTruthy();
    expect(within(next).getByText('Responsible person')).toBeTruthy();
  });

  /** ADR-017: quien reportó el hallazgo lo abre, aunque no sea el coordinador. */
  it('ofrece también a quien reportó el hallazgo, sin ser coordinador', async () => {
    useAppSession.mockReturnValue({ account: session('inspector') });

    renderRoute();
    await creationForm();

    const next = screen.getByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('form', { name: 'Create follow-up' })).toBeTruthy();
  });

  it('management ve y abre la composición aunque no haya reportado el hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ reported_by: '77777777-7777-4777-8777-777777777777' })] }),
    );
    useAppSession.mockReturnValue({ account: session('management') });

    renderRoute();
    await creationForm();

    const next = screen.getByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('form', { name: 'Create follow-up' })).toBeTruthy();
  });

  it('no ofrece la creación a un inspector que no reportó el hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ reported_by: '77777777-7777-4777-8777-777777777777' })] }),
    );
    useAppSession.mockReturnValue({ account: session('inspector') });

    renderRoute();

    // El nombre del paso sigue escrito en la copia; lo que no está es con qué ejecutarlo.
    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).queryByRole('form', { name: 'Create follow-up' })).toBeNull();
  });

  it('ofrece al responsable empezar el trabajo', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
    useAppSession.mockReturnValue({ account: session('inspector') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Start work' })).toBeTruthy();
  });

  it('el reportante inicia el trabajo asignado a otra persona y la ficha pasa a in_progress', async () => {
    let findingReads = 0;
    getSubmittedInspection.mockImplementation(() => {
      findingReads += 1;
      return Promise.resolve(
        report({ findings: [finding({ state: findingReads === 1 ? 'assigned' : 'in_progress' })] }),
      );
    });
    listActions.mockImplementation(() =>
      Promise.resolve([action({ state: findingReads < 2 ? 'open' : 'in_progress' })]),
    );
    useAppSession.mockReturnValue({
      account: { ...session('inspector'), personId: '77777777-7777-4777-8777-777777777777' },
    });

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Start work' }));

    await waitFor(() =>
      expect(transitionAction).toHaveBeenCalledWith(action().id, {
        to: 'in_progress',
        note: undefined,
        reason: undefined,
        evidence: [],
      }),
    );
    await waitFor(() => expectCurrentStage('In progress'));
  });

  it('ofrece la verificación a management', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'verification' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'awaiting_verification' })]);
    useAppSession.mockReturnValue({ account: session('management') });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByRole('button', { name: 'Verify and close' })).toBeTruthy();
    expect(within(next).getByRole('button', { name: 'Send it back' })).toBeTruthy();
    // La razón es del rechazo: no rotula al botón que cierra.
    expect(within(next).queryByLabelText('Reason')).toBeNull();
  });

  it('el lector sin permiso ve a quién espera y ningún control principal', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({
        findings: [
          finding({
            state: 'in_progress',
            reported_by: '77777777-7777-4777-8777-777777777777',
          }),
        ],
      }),
    );
    listActions.mockResolvedValue([action({ state: 'in_progress' })]);
    useAppSession.mockReturnValue({
      account: { ...session('inspector'), personId: '77777777-7777-4777-8777-777777777777' },
    });

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).getByText(/Ada Reid/)).toBeTruthy();
    expect(within(next).queryByRole('button')).toBeNull();
  });
});

/**
 * LA FICHA ABRE POR LA LECTURA. Lo que salió mal está entero desde el primer momento; lo que
 * llega plegado es el ciclo de un hallazgo que todavía no decidió nada, y solo ese.
 */
describe('InspectionFindingsRoute — la ficha abierta', () => {
  beforeEach(() => {
    getSubmittedInspection.mockResolvedValue(report());
  });

  it('el hallazgo levantado llega con la lectura entera y el acto a un control', async () => {
    renderRoute();

    // Lo que salió mal está completo desde el primer momento.
    expect(await screen.findByText('Machine guards in place')).toBeTruthy();
    expect(screen.getByText('Guard missing on the infeed of packaging line 3')).toBeTruthy();
    expect(screen.getByText('Refit the guard before the line runs again.')).toBeTruthy();
    expect(screen.getByText('1 photo')).toBeTruthy();

    // El ciclo, en cambio, está en blanco: no hay tira ni formulario, hay un control.
    const toggle = screen.getByRole('button', { name: 'Create a follow-up' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Finding lifecycle' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Raised' })).toBeNull();
  });

  /** Y desplegarlo trae la tira entera, con el compromiso en la etapa que va a escribir. */
  it('el control despliega el ciclo y la composición', async () => {
    renderRoute();

    const form = await creationForm();

    expect(screen.getByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Next step' })).getByRole('form', {
      name: 'Create follow-up',
    })).toBe(form);
    expect(screen.getByRole('tab', { name: 'Assigned' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Create a follow-up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('separa crear de ocultar sin descartar la composición', async () => {
    renderRoute();

    const form = await creationForm();
    await completeForm(form);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create a follow-up' }));
    const reopened = screen.getByRole('form', { name: 'Create follow-up' });
    expect((within(reopened).getByLabelText('Responsible person') as HTMLSelectElement).value).toBe(
      PERSON,
    );
  });

  /**
   * El roster es por hallazgo (`/findings/:id/roster`, ADR-017), así que no hay una consulta
   * que sirva para todos: lo pide el hallazgo cuya composición alguien desplegó, y solo ese.
   */
  it('pide el roster recién cuando alguien despliega la composición', async () => {
    renderRoute();

    await screen.findByRole('button', { name: 'Create a follow-up' });
    expect(listFindingRoster).not.toHaveBeenCalled();

    await creationForm();
    await waitFor(() => expect(listFindingRoster).toHaveBeenCalledWith(FINDING));
  });

  it('no pide el roster de un hallazgo que ya está en marcha', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(listFindingRoster).not.toHaveBeenCalled();
  });

  /**
   * Sin control para crear no hay nada que plegar: queda el registro, que es lo que hay que
   * auditar, y no se le esconde detrás de una pulsación a quien solo puede leer.
   */
  it('sin permiso para crear, el ciclo se lee sin plegar', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ reported_by: '77777777-7777-4777-8777-777777777777' })] }),
    );
    useAppSession.mockReturnValue({ account: session('inspector') });

    renderRoute();

    expect(await screen.findByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Create a follow-up' }),
    ).toBeNull();
    expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull();
    // Y sin composición no hay excepción: la etapa que escribiría no se ofrece.
    expect(screen.getByRole('tab', { name: 'Raised' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Assigned' })).toBeNull();
  });

  it('con las acciones caídas, el ciclo se lee igual', async () => {
    listActions.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull();
  });

  it('el hallazgo ya asignado se lee en el paso que sigue', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
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
   * CERO NO SE AFIRMA SIN HABER LEÍDO. Con la lista de acciones caída, "no follow-up
   * yet" tendría la misma cara que la verdad y el coordinador abriría un duplicado.
   */
  it('no declara un hallazgo sin acciones cuando no pudo leerlas', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listActions.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(
      await screen.findByText('Existing follow-ups need a connection.'),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Finding lifecycle' })).toBeTruthy();
    expectCurrentStage('Raised');
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
  });

  it('crea la acción sobre el hallazgo de esa pregunta y con el roster de ese hallazgo', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const form = await creationForm();
    await completeForm(form);
    submit(form);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(listFindingRoster).toHaveBeenCalledWith(FINDING);
    expect(createAction).toHaveBeenCalledWith(FINDING, {
      assignee_person_id: PERSON,
      description: 'Install a fixed guard before restarting the line',
      due_at: new Date('2099-08-30').toISOString(),
    });
  });

  it('retira el formulario y muestra la acción recién creada', async () => {
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

    const form = await creationForm();
    await completeForm(form);
    submit(form);

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Create follow-up' })).toBeNull(),
    );
    /*
      LA LECTURA SIGUE AL HALLAZGO: escrito el compromiso, el hallazgo queda en `assigned`, y
      ahí se leen las dos cosas —lo que se acaba de prometer y `Start work`—. Quedarse en la
      etapa anterior dejaría la ficha mostrando un registro viejo justo después del acto que
      la cambió.
    */
    expect(await screen.findByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assigned' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expectCurrentStage('Assigned');
  });

  it('no envía un plazo que no es futuro', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    const form = await creationForm();
    await completeForm(form);
    fireEvent.change(within(form).getByLabelText('Deadline'), {
      target: { value: '2000-01-01' },
    });
    submit(form);

    expect((await within(form).findByRole('alert')).textContent).toContain(
      'Deadline must be in the future.',
    );
    expect(createAction).not.toHaveBeenCalled();
  });

  it('no envía dos veces mientras la creación está pendiente', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    createAction.mockReturnValue(new Promise(() => undefined));

    renderRoute();

    const form = await creationForm();
    await completeForm(form);

    // El paso se toma UNA vez: al enviar, el botón pasa a decir «Creating…» y el segundo
    // envío no encuentra nada que pulsar.
    fireEvent.submit(form);
    expect(
      ((await within(form).findByRole('button', { name: 'Creating…' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(form);

    expect(createAction).toHaveBeenCalledTimes(1);
  });

  it('muestra el rechazo y conserva todos los campos del borrador', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    createAction.mockRejectedValue(new Error('The server rejected this commitment.'));

    renderRoute();

    const form = await creationForm();
    await completeForm(form);
    submit(form);

    expect((await within(form).findByRole('alert')).textContent).toContain(
      'The server rejected this commitment.',
    );
    expect(
      (within(form).getByLabelText('Responsible person') as HTMLSelectElement).value,
    ).toBe(PERSON);
    expect(
      (within(form).getByLabelText('Describe the follow-up') as HTMLTextAreaElement)
        .value,
    ).toBe(
      'Install a fixed guard before restarting the line',
    );
    expect((within(form).getByLabelText('Deadline') as HTMLInputElement).value).toBe(
      '2099-08-30',
    );
  });

  it('limita un fallo del roster al formulario del paso', async () => {
    getSubmittedInspection.mockResolvedValue(report());
    listFindingRoster.mockRejectedValue(new Error('offline'));

    renderRoute();

    const form = await creationForm();
    expect(
      await within(form).findByText('The active people for this site need a connection.'),
    ).toBeTruthy();
    expect(
      (within(form).getByRole('button', { name: 'Create follow-up' }) as HTMLButtonElement).disabled,
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

  /** La etapa donde el paso tiene dos salidas, con la cuenta que puede pedir las dos. */
  async function verificationStep(): Promise<HTMLElement> {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'verification' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'awaiting_verification' })]);
    useAppSession.mockReturnValue({ account: session('management') });

    renderRoute();

    return await screen.findByRole('region', { name: 'Next step' });
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
    useAppSession.mockReturnValue({ account: session('inspector') });

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
   * El paso se ejecuta con una sola pulsación: los campos que la etapa pide y el botón de la
   * transición están dibujados desde que se lee el hallazgo. Nada revela el formulario, así que
   * tampoco hay nada que replegar. Empezar el trabajo no pide ninguno —se anuncia como "No
   * additional information is required", y un campo debajo lo desmentiría (`stepForm`)—.
   *
   * La única excepción es la salida que EXIGE algo escrito —devolver el trabajo pide una
   * razón—, que no puede ejecutarse de una pulsación y por eso se pliega. Acá no hay ninguna.
   */
  it('dibuja los campos del paso sin pulsar nada, y no ofrece un control que lo pliegue', async () => {
    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).queryByLabelText(/Note/)).toBeNull();
    expect(within(next).getByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(transitionAction).not.toHaveBeenCalled();
  });

  /**
   * Devolver el trabajo se escribe detrás de su propio botón: la razón que exige aparece con
   * él y no antes, y mientras esté vacía no hay nada que enviar —el servidor la vuelve a
   * exigir igual (`requires: ['reason']`), esto es comodidad—.
   */
  it('el rechazo revela la razón, espera a que diga algo y devuelve la acción a In progress', async () => {
    const next = await verificationStep();

    fireEvent.click(within(next).getByRole('button', { name: 'Send it back' }));

    // Lo revelado reemplaza a lo que estaba a la vista: cerrar no se ofrece a medias.
    expect(within(next).queryByRole('button', { name: 'Verify and close' })).toBeNull();
    expect(
      (within(next).getByRole('button', { name: 'Send it back' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(within(next).getByLabelText('Reason'), {
      target: { value: 'The guard is still loose.' },
    });
    fireEvent.change(within(next).getByLabelText(/Note/), {
      target: { value: 'Photo shows the old bracket.' },
    });
    fireEvent.click(within(next).getByRole('button', { name: 'Send it back' }));

    await waitFor(() => expect(transitionAction).toHaveBeenCalledWith(action().id, {
      to: 'in_progress',
      note: 'Photo shows the old bracket.',
      reason: 'The guard is still loose.',
      evidence: [],
    }));
  });

  it('cancelar el rechazo devuelve las dos salidas y no deja la razón escrita', async () => {
    const next = await verificationStep();

    fireEvent.click(within(next).getByRole('button', { name: 'Send it back' }));
    fireEvent.change(within(next).getByLabelText('Reason'), {
      target: { value: 'Pressed it by mistake.' },
    });
    fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));

    expect(within(next).getByRole('button', { name: 'Verify and close' })).toBeTruthy();
    expect(within(next).queryByLabelText('Reason')).toBeNull();
    expect(transitionAction).not.toHaveBeenCalled();

    fireEvent.click(within(next).getByRole('button', { name: 'Send it back' }));
    expect((within(next).getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('');
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

describe('InspectionFindingsRoute — Edit assignment (ADR-021)', () => {
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
    expect(
      (within(form).getByLabelText('Describe the follow-up') as HTMLTextAreaElement)
        .value,
    ).toBe(
      'Refit the guard on packaging line 3',
    );

    fireEvent.change(within(form).getByLabelText('Describe the follow-up'), {
      target: { value: 'Install an interlocked guard and update the lockout procedure' },
    });
    fireEvent.change(within(form).getByLabelText('Deadline'), {
      target: { value: '2099-09-01T12:00' },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(replaceAssignment).toHaveBeenCalledWith(action().id, {
        assignee_person_id: PERSON,
        description: 'Install an interlocked guard and update the lockout procedure',
        due_at: new Date('2099-09-01T12:00').toISOString(),
      }),
    );
    // El hallazgo sigue en Assigned y Start work sigue ofreciéndose.
    expectCurrentStage('Assigned');
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
  });

  it('conserva lo escrito cuando el servidor rechaza la edición', async () => {
    replaceAssignment.mockRejectedValue(
      new Error('An action assignment cannot be edited once the work is declared done'),
    );

    renderRoute();
    const next = await screen.findByRole('region', { name: 'Next step' });
    fireEvent.click(within(next).getByRole('button', { name: 'Edit assignment' }));
    const form = within(next).getByRole('form', { name: 'Edit assignment' });
    await within(form).findByRole('option', { name: /\([0-9]+\)$/ });

    fireEvent.change(within(form).getByLabelText('Describe the follow-up'), {
      target: { value: 'A corrected description that the server will reject here' },
    });
    fireEvent.submit(form);

    expect((await within(form).findByRole('alert')).textContent).toContain('cannot be edited');
    expect(
      (within(form).getByLabelText('Describe the follow-up') as HTMLTextAreaElement)
        .value,
    ).toBe(
      'A corrected description that the server will reject here',
    );
  });

  it('ofrece Edit assignment a management aunque no haya reportado el hallazgo', async () => {
    useAppSession.mockReturnValue({ account: session('management') });
    getSubmittedInspection.mockResolvedValue(
      report({
        findings: [
          finding({ state: 'assigned', reported_by: '11111111-1111-4111-8111-111111111111' }),
        ],
      }),
    );

    renderRoute();

    await screen.findByRole('region', { name: 'Next step' });
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeTruthy();
  });

  it('mantiene Edit assignment mientras el trabajo está en curso', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'in_progress' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'in_progress' })]);

    renderRoute();

    await screen.findByRole('region', { name: 'Next step' });
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeTruthy();
  });

  /**
   * ADR-021: en Verification lo que hay que decidir es si el trabajo se acepta. Corregir el
   * compromiso ahí pasa por `Send it back`, que devuelve la acción a In progress.
   */
  it('retira Edit assignment en verification y deja las dos salidas de la etapa', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'verification' })] }),
    );
    listActions.mockResolvedValue([action({ state: 'awaiting_verification' })]);

    renderRoute();

    const next = await screen.findByRole('region', { name: 'Next step' });
    expect(within(next).queryByRole('button', { name: 'Edit assignment' })).toBeNull();
    expect(within(next).getByRole('button', { name: 'Verify and close' })).toBeTruthy();
    expect(within(next).getByRole('button', { name: 'Send it back' })).toBeTruthy();
  });

  it('presenta solamente la asignación vigente', async () => {
    listActions.mockResolvedValue([
      action({ description: 'Install an interlocked guard instead' }),
    ]);

    renderRoute();

    // El registro se lee abriendo su etapa; lo que está abierto por defecto es el paso.
    fireEvent.click(await screen.findByRole('tab', { name: 'Assigned' }));

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Current assignment')).toBeTruthy();
    expect(within(record).getByText('Install an interlocked guard instead')).toBeTruthy();
    expect(within(record).queryByText('Assignment history')).toBeNull();
    expect(getAction).not.toHaveBeenCalled();
  });

  /**
   * El registro contesta una pregunta que alguien hizo —abrir la etapa—, así que contesta
   * también cuando la respuesta es "se prometió esto y nada más". Antes se callaba sin
   * ediciones, cuando aparecía solo y sin que nadie lo pidiera.
   */
  it('muestra una sola asignación', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Assigned' }));

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Current assignment')).toBeTruthy();
    expect(within(record).getByText('Refit the guard on packaging line 3')).toBeTruthy();
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
          from_state: 'in_progress',
          to_state: 'awaiting_verification',
          actor_user_id: PERSON,
          note: 'Interlock installed and tested.',
          reason: null,
          occurred_at: '2027-08-05T11:00:00.000Z',
          recorded_at: '2027-08-05T11:00:01.000Z',
          evidence: [
            {
              id: 'eeeeeeee-eeee-4eee-8eee-000000000004',
              kind: 'before',
              object_key: 'actions/accepted-before.jpg',
              created_at: '2027-08-05T11:00:00.000Z',
            },
            {
              id: 'eeeeeeee-eeee-4eee-8eee-000000000005',
              kind: 'after',
              object_key: 'actions/accepted-after-1.jpg',
              created_at: '2027-08-05T11:00:00.000Z',
            },
            {
              id: 'eeeeeeee-eeee-4eee-8eee-000000000006',
              kind: 'after',
              object_key: 'actions/accepted-after-2.jpg',
              created_at: '2027-08-05T11:00:00.000Z',
            },
          ],
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-000000000005',
          position: 5,
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

  /**
   * Una etapa por delante no ocurrió, no tiene registro, y ofrecerla prometería una lectura que
   * no existe. Los tres pasos de acá en adelante no piden excepción: se leen en la etapa desde
   * la que se ejecutan. La única que la pide es el alta desplegada, que no llega hasta acá.
   */
  it('no ofrece como pestaña una etapa que no ocurrió', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByRole('tab', { name: 'Raised' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assigned' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'In progress' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Verification' })).toBeNull();
    // Siguen escritas: el ciclo entero, no el recorrido hecho.
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Verification')).toBeTruthy();
  });

  /**
   * EL CORAZÓN DEL CICLO: lo que ya se decidió y lo que sigue, en la misma pestaña. El
   * compromiso escrito se lee arriba del botón que lo pone en marcha, y no una pestaña atrás.
   */
  it('lee el compromiso y su próximo paso en la misma etapa', async () => {
    getSubmittedInspection.mockResolvedValue(
      report({ findings: [finding({ state: 'assigned' })] }),
    );
    listActions.mockResolvedValue([action()]);
    getAction.mockResolvedValue(actionDetail());

    renderRoute();

    expect(
      (await screen.findByRole('tab', { name: 'Assigned' })).getAttribute('aria-selected'),
    ).toBe('true');

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Current assignment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(screen.queryByText(/Nothing has been recorded here yet/)).toBeNull();
  });

  it('abre el registro de una etapa pasada sin mover el hallazgo', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Assigned' }));

    const record = await screen.findByRole('region', { name: 'Assigned record' });
    expect(within(record).getByText('Current assignment')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assigned' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // Dónde está el hallazgo no cambió por leer otra etapa.
    expectCurrentStage('Closed');
  });

  /**
   * LA IDA Y VUELTA ES UNA SOLA CONVERSACIÓN. Abrir `In progress` o `Verification` contesta lo
   * mismo, en el orden del stream: repartida por el estado de destino de cada evento, los
   * motivos quedaban sin la declaración que los provocó y las declaraciones sin el rechazo que
   * las siguió, y el orden había que reconstruirlo saltando de pestaña.
   */
  it('lee la misma conversación en In progress y en Verification', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'In progress' }));

    const inProgress = await screen.findByRole('region', { name: 'In progress record' });
    const thread = within(inProgress)
      .getAllByRole('listitem')
      .map((item) => item.textContent);

    expect(thread).toHaveLength(4);
    expect(thread[0]).toContain('Work started');
    expect(thread[1]).toContain('Guard refitted on the infeed.');
    expect(thread[2]).toContain('The guard is not interlocked yet.');
    expect(thread[3]).toContain('Interlock installed and tested.');

    fireEvent.click(screen.getByRole('tab', { name: 'Verification' }));

    const verification = await screen.findByRole('region', { name: 'Verification record' });
    expect(
      within(verification)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(thread);
  });

  /**
   * EL PASO SE NOMBRA POR LA DECISIÓN, NO POR EL BOTÓN. En un hilo donde se alternan
   * declaraciones y rechazos, el nombre es lo único que dice en qué sentido va cada renglón
   * —lo que hacían las dos pestañas— y por eso vuelve; el botón, que promete algo que ya
   * ocurrió, no.
   */
  it('nombra la decisión de cada paso y no el botón que la daría', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'In progress' }));

    const record = await screen.findByRole('region', { name: 'In progress record' });
    expect(within(record).getByText('The guard is not interlocked yet.')).toBeTruthy();
    expect(within(record).getByText('Sent back')).toBeTruthy();
    expect(within(record).getAllByText('Work declared done')).toHaveLength(2);
    expect(within(record).queryByText('Start work')).toBeNull();
    expect(within(record).queryByText('Send it back')).toBeNull();
  });

  /** El paso que empezó el trabajo no escribió nada, y aun así el hilo empieza en él. */
  it('presenta el paso que no escribió nada con su nombre y nada debajo', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'In progress' }));

    const record = await screen.findByRole('region', { name: 'In progress record' });
    const started = within(record).getByText('Work started').closest('li');

    expect(started?.textContent).toBe('Work started');
  });

  /**
   * QUÉ SE COMPROMETIÓ ES LO QUE SOSTIENE LA LECTURA DEL PASO. La etapa contestaba con la
   * etiqueta del evento y el instante en que se registró, y ninguna de las dos dice qué
   * trabajo se debe, quién lo debe ni para cuándo.
   */
  it('encabeza la etapa con la acción correctiva y no con el instante del evento', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'In progress' }));

    const record = await screen.findByRole('region', { name: 'In progress record' });
    expect(within(record).getByText('Follow-up')).toBeTruthy();
    expect(within(record).getByText('Refit the guard on packaging line 3')).toBeTruthy();
    expect(within(record).getByText('Ada Reid')).toBeTruthy();
    expect(within(record).getByText('2027-08-30')).toBeTruthy();
    // Ni el reloj del stream ni la etiqueta de la transición ocupan valores de la etapa.
    expect(within(record).queryByText('Recorded')).toBeNull();
    expect(within(record).queryByText('Action')).toBeNull();
  });

  it('cuenta la evidencia y conserva la nota de la etapa de verificación', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Verification' }));

    const record = await screen.findByRole('region', { name: 'Verification record' });
    expect(within(record).getByText('Guard refitted on the infeed.')).toBeTruthy();
    expect(within(record).getByText(/1 before, 1 after/)).toBeTruthy();
    expect(within(record).queryByLabelText('Accepted evidence photographs')).toBeNull();
    expect(within(record).queryByRole('img')).toBeNull();
    // El rechazo que siguió a esa declaración se lee acá mismo: es el mismo hilo.
    expect(within(record).getByText('The guard is not interlocked yet.')).toBeTruthy();
    // El cierre es otra etapa y no se cuela en esta.
    expect(within(record).queryByText('Verified on the floor.')).toBeNull();
  });

  it('muestra en Closed solo las fotos aceptadas, agrupadas y con sus URLs firmadas', async () => {
    renderRoute();

    const record = await screen.findByRole('region', { name: 'Closed record' });
    const accepted = await within(record).findByLabelText('Accepted evidence photographs');
    expect(within(accepted).getByRole('heading', { name: 'Before' })).toBeTruthy();
    expect(within(accepted).getByRole('heading', { name: 'After' })).toBeTruthy();

    const before = await within(accepted).findByRole('img', { name: 'Before evidence photo 1' });
    const after = await within(accepted).findByRole('img', { name: 'After evidence photo 2' });
    expect(before.getAttribute('src')).toBe(
      'https://bucket.test/eeeeeeee-eeee-4eee-8eee-000000000004',
    );
    expect(after.getAttribute('src')).toBe(
      'https://bucket.test/eeeeeeee-eeee-4eee-8eee-000000000006',
    );
    expect(before.closest('a')?.getAttribute('href')).toBe(before.getAttribute('src'));
    expect(before.closest('a')?.getAttribute('target')).toBe('_blank');
    expect(getEvidenceDownload).not.toHaveBeenCalledWith(
      'eeeeeeee-eeee-4eee-8eee-000000000000',
    );
  });

  it('mantiene separada la evidencia aceptada de cada acción cerrada', async () => {
    const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const secondEvidenceId = 'ffffffff-ffff-4fff-8fff-000000000007';
    const second = history();

    listActions.mockResolvedValue([
      action({ state: 'closed' }),
      action({ id: secondId, state: 'closed', description: 'Replace the emergency stop' }),
    ]);
    getAction.mockImplementation((id: string) =>
      Promise.resolve(
        id === secondId
          ? {
              ...second,
              id: secondId,
              events: second.events.map((event) =>
                event.position === 4
                  ? {
                      ...event,
                      evidence: [
                        {
                          id: secondEvidenceId,
                          kind: 'after' as const,
                          object_key: 'actions/second-accepted-after.jpg',
                          created_at: '2027-08-05T11:00:00.000Z',
                        },
                      ],
                    }
                  : event,
              ),
            }
          : history(),
      ),
    );

    renderRoute();

    const record = await screen.findByRole('region', { name: 'Closed record' });
    await waitFor(() =>
      expect(within(record).getAllByLabelText('Accepted evidence photographs')).toHaveLength(2),
    );
    expect(within(record).getByText('Refit the guard on packaging line 3')).toBeTruthy();
    expect(within(record).getByText('Replace the emergency stop')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(record)
          .getAllByRole('img')
          .map((image) => image.getAttribute('src')),
      ).toContain(`https://bucket.test/${secondEvidenceId}`),
    );
  });

  it('mantiene Closed legible cuando la declaración aceptada no tiene evidencia', async () => {
    const detail = history();
    getAction.mockResolvedValue({
      ...detail,
      events: detail.events.map((event) =>
        event.position === 4 ? { ...event, evidence: [] } : event,
      ),
    });

    renderRoute();

    const record = await screen.findByRole('region', { name: 'Closed record' });
    await within(record).findByText('Verified on the floor.');
    expect(within(record).getByText('Follow-up')).toBeTruthy();
    expect(within(record).queryByLabelText('Accepted evidence photographs')).toBeNull();
    expect(within(record).queryByRole('img')).toBeNull();
    expect(getEvidenceDownload).not.toHaveBeenCalled();
  });

  it('deja reintentar solo la foto cuya URL no se pudo obtener', async () => {
    getEvidenceDownload.mockRejectedValueOnce(new Error('offline'));

    renderRoute();

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert').textContent).toContain('Before photo 1 could not be loaded.');
    fireEvent.click(retry);

    expect(await screen.findByRole('img', { name: 'Before evidence photo 1' })).toBeTruthy();
  });

  it('no presenta el cierre sin nota como una etapa sin registro', async () => {
    const detail = history();
    getAction.mockResolvedValue({
      ...detail,
      events: detail.events.map((event) =>
        event.to_state === 'closed' ? { ...event, note: null } : event,
      ),
    });

    renderRoute();

    const record = await screen.findByRole('region', { name: 'Closed record' });
    expect(within(record).getByText('Follow-up')).toBeTruthy();
    expect(within(record).queryByText('Nothing was recorded here yet.')).toBeNull();
  });

  it('la etapa levantada muestra solo cuándo se registró sin consultar acciones', async () => {
    renderRoute();

    fireEvent.click(await screen.findByRole('tab', { name: 'Raised' }));

    const record = await screen.findByRole('region', { name: 'Raised record' });
    expect(within(record).getByText('Finding recorded date')).toBeTruthy();
    expect(within(record).getByText('2027-07-29')).toBeTruthy();
    expect(within(record).queryByText('Reported')).toBeNull();
    expect(within(record).queryByText('Photos')).toBeNull();
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
  it('no deja elegir otra etapa mientras la edición está abierta', async () => {
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
   * Avanzar mueve la lectura, y la deja donde escribe el paso SIGUIENTE: sin eso, la etapa
   * elegida se quedaría en la que acaba de terminar y la ficha mostraría un registro viejo
   * justo en el momento en que hay que ver qué sigue.
   */
  it('mueve la lectura al segmento del próximo paso cuando el hallazgo avanza', async () => {
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
    useAppSession.mockReturnValue({ account: session('inspector') });

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Start work' }));

    // El hallazgo queda en `in_progress`, y ahí se lee: lo que el trabajo registró y, debajo,
    // declararlo hecho.
    await waitFor(() => expectCurrentStage('In progress'));
    expect(
      screen.getByRole('tab', { name: 'In progress' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(await screen.findByRole('region', { name: 'Next step' })).toBeTruthy();
  });
});
