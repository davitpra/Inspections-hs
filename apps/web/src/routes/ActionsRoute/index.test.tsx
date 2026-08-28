import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionSummary, Finding, PersonWithAccount, Session } from '@hs/contracts';

import { ActionsRoute } from './index';

const listActions = vi.hoisted(() => vi.fn());
const createAction = vi.hoisted(() => vi.fn());
const listFindings = vi.hoisted(() => vi.fn());
const listPeople = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/actions', () => ({ listActions, createAction }));
vi.mock('../../api/findings', () => ({ listFindings }));
vi.mock('../../api/roster', () => ({ listPeople }));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    className,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={substitute(to, params)} className={className}>
      {children}
    </a>
  ),
}));

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const FINDING_A = '77777777-7777-4777-8777-777777777777';
const PERSON_A = '66666666-6666-4666-8666-666666666666';
const PERSON_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function substitute(to: string, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce(
    (path, [name, value]) => path.replace(`$${name}`, value),
    to,
  );
}

function action(overrides: Partial<ActionSummary> = {}): ActionSummary {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    site_id: SITE_A,
    site_name: 'St. Thomas',
    assignee_person_id: PERSON_A,
    assignee_name: 'Dana Okafor',
    description: 'Install a fixed guard on line 3',
    due_at: '2026-08-28T16:00:00.000Z',
    state: 'open',
    overdue: true,
    escalations: [],
    source: {
      kind: 'inspection',
      finding_id: FINDING_A,
      inspection_id: '88888888-8888-4888-8888-888888888888',
      scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
      template_id: '33333333-3333-4333-8333-333333333333',
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: FINDING_A,
    site_id: SITE_A,
    origin: 'inspection',
    inspection_id: '88888888-8888-4888-8888-888888888888',
    template_version_item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    item_key: 'machine.guarding',
    location_id: null,
    description: 'The fixed guard is missing from the line infeed',
    photo_object_keys: ['findings/guard.jpg'],
    reported_by: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    occurred_at: '2026-08-27T14:00:00.000Z',
    recorded_at: '2026-08-27T14:05:00.000Z',
    recurrence: null,
    ...overrides,
  };
}

function person(overrides: Partial<PersonWithAccount> = {}): PersonWithAccount {
  return {
    id: PERSON_A,
    site_id: SITE_A,
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
    userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    personId: PERSON_A,
    role,
    siteScope: [SITE_A, SITE_B],
    recordsFrom: null,
    recordsTo: null,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ActionsRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  listFindings.mockResolvedValue([]);
  listPeople.mockResolvedValue([]);
  createAction.mockResolvedValue({});
  useAppSession.mockReturnValue({ account: session('hs_coordinator') });
});

async function openCreation(description = finding().description): Promise<HTMLElement> {
  const row = (await screen.findByText(description)).closest('tr');
  if (!row) throw new Error('Finding row not found');
  fireEvent.click(within(row).getByRole('button', { name: 'Create action' }));
  return await screen.findByRole('dialog', { name: 'Create corrective action' });
}

async function completeForm(dialog: HTMLElement, assignee = PERSON_A): Promise<void> {
  await within(dialog).findByRole('option', { name: /\([0-9]+\)$/ });
  fireEvent.change(within(dialog).getByLabelText('Assignee'), { target: { value: assignee } });
  fireEvent.change(within(dialog).getByLabelText('Description'), {
    target: { value: 'Install a fixed guard before restarting the line' },
  });
  fireEvent.change(within(dialog).getByLabelText('Deadline'), {
    target: { value: '2099-08-30T12:00' },
  });
}

describe('ActionsRoute', () => {
  it('nombra la carga sin mostrar una lista vacía', () => {
    listActions.mockReturnValue(new Promise(() => undefined));

    renderRoute();

    expect(screen.getByText('Loading corrective actions…')).toBeTruthy();
    expect(screen.queryByText(/No corrective actions/)).toBeNull();
  });

  it('explica que el listado necesita conexión', async () => {
    listActions.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('Corrective actions need a connection.')).toBeTruthy();
  });

  it('distingue una planta sin acciones de una lista vacía por error', async () => {
    listActions.mockResolvedValue([]);

    renderRoute();

    expect(
      await screen.findByText('No corrective actions have been recorded for your sites.'),
    ).toBeTruthy();
  });

  it('agrupa por inspección y enlaza a la vista de esa inspección', async () => {
    const manual = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: { kind: 'manual_finding', finding_id: '77777777-7777-4777-8777-777777777777' },
    });
    listActions.mockResolvedValue([action(), manual]);

    renderRoute();

    expect(await screen.findByText('Monthly walkthrough')).toBeTruthy();
    expect(screen.getByText('Other sources')).toBeTruthy();
    expect(screen.getByText('St. Thomas')).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'View corrective actions' })[0]!.getAttribute('href'),
    ).toBe('/actions/inspection/88888888-8888-4888-8888-888888888888');
  });

  it('muestra un hallazgo sin acciones y permite crear acciones repetidas', async () => {
    let actionReads = 0;
    listFindings.mockResolvedValue([finding()]);
    listPeople.mockResolvedValue([person()]);
    listActions.mockImplementation(() => {
      actionReads += 1;
      if (actionReads === 1) return Promise.resolve([]);
      if (actionReads === 2) return Promise.resolve([action()]);
      return Promise.resolve([
        action(),
        action({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
      ]);
    });

    renderRoute();

    const firstDialog = await openCreation();
    await completeForm(firstDialog);
    fireEvent.submit(within(firstDialog).getByRole('button', { name: 'Create action' }).closest('form')!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Monthly walkthrough')).toBeTruthy();
    let findingRow = screen.getByText(finding().description).closest('tr')!;
    expect(within(findingRow).getByText('1')).toBeTruthy();

    const secondDialog = await openCreation();
    await completeForm(secondDialog);
    fireEvent.submit(within(secondDialog).getByRole('button', { name: 'Create action' }).closest('form')!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    findingRow = screen.getByText(finding().description).closest('tr')!;
    expect(within(findingRow).getByText('2')).toBeTruthy();
    expect(createAction).toHaveBeenCalledTimes(2);
  });

  it('carga en cada formulario solo el roster del sitio del hallazgo', async () => {
    const findingB = finding({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      site_id: SITE_B,
      description: 'Emergency stop is blocked by stored materials',
    });
    const personB = person({
      id: PERSON_B,
      site_id: SITE_B,
      employee_number: '20881',
      first_name: 'Nora',
      last_name: 'Chen',
    });
    listFindings.mockResolvedValue([finding(), findingB]);
    listActions.mockResolvedValue([]);
    listPeople.mockImplementation((siteId: string) =>
      Promise.resolve(siteId === SITE_A ? [person()] : [personB]),
    );

    renderRoute();

    const dialogA = await openCreation();
    expect(await within(dialogA).findByRole('option', { name: 'Ada Reid (10472)' })).toBeTruthy();
    expect(within(dialogA).queryByRole('option', { name: 'Nora Chen (20881)' })).toBeNull();
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Cancel' }));

    const dialogB = await openCreation(findingB.description);
    expect(await within(dialogB).findByRole('option', { name: 'Nora Chen (20881)' })).toBeTruthy();
    expect(listPeople).toHaveBeenNthCalledWith(1, SITE_A);
    expect(listPeople).toHaveBeenNthCalledWith(2, SITE_B);
  });

  it('mantiene findings y acciones legibles sin ofrecer creación a otros roles', async () => {
    useAppSession.mockReturnValue({ account: session('supervisor') });
    listFindings.mockResolvedValue([finding()]);
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByText(finding().description)).toBeTruthy();
    expect(await screen.findByText('Monthly walkthrough')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create action' })).toBeNull();
  });

  it('mantiene los hallazgos utilizables cuando falla la lista de acciones', async () => {
    listFindings.mockResolvedValue([finding()]);
    listActions.mockRejectedValue(new Error('offline'));
    listPeople.mockResolvedValue([person()]);

    renderRoute();

    const row = (await screen.findByText(finding().description)).closest('tr')!;
    expect(within(row).getByText('Unavailable')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Create action' })).toBeTruthy();
    expect(await screen.findByText('Corrective actions need a connection.')).toBeTruthy();
  });

  it('mantiene las acciones utilizables cuando falla la lista de hallazgos', async () => {
    listFindings.mockRejectedValue(new Error('offline'));
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findByText('Findings need a connection.')).toBeTruthy();
    expect(await screen.findByText('Monthly walkthrough')).toBeTruthy();
  });

  it('limita un fallo del roster al formulario abierto', async () => {
    listFindings.mockResolvedValue([finding()]);
    listActions.mockResolvedValue([]);
    listPeople.mockRejectedValue(new Error('offline'));

    renderRoute();

    const dialog = await openCreation();
    expect(
      await within(dialog).findByText('The active people for this site need a connection.'),
    ).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create action' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(finding().description)).toBeTruthy();
  });

  it('no envía dos veces mientras la creación está pendiente', async () => {
    listFindings.mockResolvedValue([finding()]);
    listActions.mockResolvedValue([]);
    listPeople.mockResolvedValue([person()]);
    createAction.mockReturnValue(new Promise(() => undefined));

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    const form = within(dialog).getByRole('button', { name: 'Create action' }).closest('form')!;
    fireEvent.submit(form);
    expect((await within(dialog).findByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form);

    expect(createAction).toHaveBeenCalledTimes(1);
  });

  it('muestra el rechazo y conserva todos los campos del borrador', async () => {
    listFindings.mockResolvedValue([finding()]);
    listActions.mockResolvedValue([]);
    listPeople.mockResolvedValue([person()]);
    createAction.mockRejectedValue(new Error('The server rejected this commitment.'));

    renderRoute();

    const dialog = await openCreation();
    await completeForm(dialog);
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Create action' }).closest('form')!);

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The server rejected this commitment.',
    );
    expect((within(dialog).getByLabelText('Assignee') as HTMLSelectElement).value).toBe(PERSON_A);
    expect((within(dialog).getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Install a fixed guard before restarting the line',
    );
    expect((within(dialog).getByLabelText('Deadline') as HTMLInputElement).value).toBe(
      '2099-08-30T12:00',
    );
  });
});
