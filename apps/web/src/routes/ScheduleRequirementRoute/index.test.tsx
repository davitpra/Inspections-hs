import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectionSchedule, InspectorOption, ScheduledInspection, Session, Site, TemplateOption } from '@hs/contracts';

import { ScheduleRequirementRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const RULE = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const VERSION = '66666666-6666-4666-8666-666666666666';
const INSPECTION = '77777777-7777-4777-8777-777777777777';
const CANDIDATE = '88888888-8888-4888-8888-888888888888';

const listSites = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const listInspectorCandidates = vi.hoisted(() => vi.fn());
const listSchedules = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const createScheduledInspection = vi.hoisted(() => vi.fn());
const assignInspector = vi.hoisted(() => vi.fn());
const cancelScheduledInspection = vi.hoisted(() => vi.fn());
const makeScheduledInspectionVisible = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const useParams = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({
  listSites,
  listTemplates,
  listInspectorCandidates,
  listSchedules,
  listScheduled,
  createScheduledInspection,
  assignInspector,
  cancelScheduledInspection,
  makeScheduledInspectionVisible,
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  useParams,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function session(role: Session['role']): { account: Session } {
  return { account: { userId: USER, personId: PERSON, role, siteScope: [SITE] } };
}

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return {
    id: RULE,
    site_id: SITE,
    template_id: TEMPLATE,
    template_name: 'Quarterly workplace inspection',
    frequency_months: 3,
    anchor_month: 2,
    default_inspector_id: null,
    default_inspector_name: null,
    created_at: '2020-01-01T00:00:00.000Z',
    deactivated_at: null,
    archived_at: null,
    ...overrides,
  };
}

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return {
    id: INSPECTION,
    site_id: SITE,
    period_start: '2026-02-01',
    period_months: 3,
    period_end: '2026-04-30',
    template_id: TEMPLATE,
    template_name: 'Quarterly workplace inspection',
    template_version_id: VERSION,
    template_version: 2,
    inspector_id: null,
    inspector_name: null,
    scheduled_at: '2026-02-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'open',
    inspection_id: null,
    completed_at: null,
    ...overrides,
  };
}

function template(): TemplateOption {
  return { id: TEMPLATE, key: 'quarterly', name: 'Quarterly workplace inspection', latest_version: 2, latest_version_id: VERSION, latest_published_at: '2026-01-01' };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ScheduleRequirementRoute /></QueryClientProvider>);
}

beforeEach(() => {
  useParams.mockReturnValue({ scheduleId: RULE });
  useAppSession.mockReturnValue(session('coordinator'));
  listSites.mockReset().mockResolvedValue([{ id: SITE, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null } satisfies Site]);
  listTemplates.mockReset().mockResolvedValue([template()]);
  listInspectorCandidates.mockReset().mockResolvedValue([{ id: CANDIDATE, employee_number: 'E-1', first_name: 'Dana', last_name: 'Okafor' } satisfies InspectorOption]);
  listSchedules.mockReset().mockResolvedValue([rule()]);
  listScheduled.mockReset().mockResolvedValue([]);
  createScheduledInspection.mockReset().mockResolvedValue(inspection());
  assignInspector.mockReset().mockResolvedValue(inspection({ inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' }));
  cancelScheduledInspection.mockReset().mockResolvedValue(inspection({ status: 'cancelled', cancelled_at: '2026-02-05T00:00:00.000Z', cancellation_reason: 'Plant shutdown' }));
  makeScheduledInspectionVisible.mockReset().mockResolvedValue(inspection({ visible_early: true }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('plan anual enfocado', () => {
  it('muestra la regla, planta, cadencia y solo sus cuatro períodos', async () => {
    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Quarterly workplace inspection' })).toBeTruthy();
    expect(screen.getByText(/St\. Thomas/)).toBeTruthy();
    expect(screen.getByText(/starting in February/)).toBeTruthy();
    expect(screen.getByText(/cannot be changed here/)).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Period', 'Status', 'Inspector', 'Visibility', 'Action']);
    expect(screen.getAllByRole('row')).toHaveLength(5);
  });

  it('navega al año siguiente manteniendo la regla', async () => {
    renderRoute();
    const current = new Date().getFullYear();

    const next = current + 1;

    fireEvent.click(await screen.findByRole('button', { name: `Go to ${next}` }));
    expect(screen.getByRole('button', { name: String(next) }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Quarterly workplace inspection' })).toBeTruthy();
  });

  it('informa un requisito no encontrado y ofrece volver', async () => {
    useParams.mockReturnValue({ scheduleId: '99999999-9999-4999-8999-999999999999' });
    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Requirement not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to scheduling' })).toBeTruthy();
  });
});

describe('operaciones por fila', () => {
  it('ofrece cancelar un período abierto, pero no uno completado', async () => {
    listScheduled.mockResolvedValue([
      inspection(),
      inspection({ id: '99999999-9999-4999-8999-999999999999', period_start: '2026-05-01', period_end: '2026-07-31', status: 'completed', inspection_id: USER }),
    ]);
    renderRoute();

    const rows = await screen.findAllByRole('row');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'More actions for Feb–Apr' }));
    expect(screen.getByRole('menuitem', { name: 'Cancel period' })).toBeTruthy();
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'More actions for Feb–Apr' }));
    expect(within(rows[2]!).queryByRole('button', { name: 'More actions for May–Jul' })).toBeNull();
  });

  it('abre sin selector y nombra la versión congelada', async () => {
    renderRoute();

    const menu = (await screen.findAllByRole('button', { name: /^More actions for / }))[0]!;
    expect(screen.queryByRole('combobox', { name: /Assign inspector/ })).toBeNull();
    fireEvent.click(menu);
    const open = screen.getByRole('menuitem', { name: 'Open period' });
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false));
    fireEvent.click(open);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Version 2 will be frozen/)).toBeTruthy();
    expect(createScheduledInspection).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open period' }));

    await waitFor(() => expect(createScheduledInspection).toHaveBeenCalledWith({ site_id: SITE, template_id: TEMPLATE, period_start: '2026-02-01', visible_early: false }));
  });

  it('no asigna hasta confirmar explícitamente', async () => {
    listScheduled.mockResolvedValue([inspection()]);
    renderRoute();
    fireEvent.click((await screen.findAllByRole('button', { name: /^More actions for / }))[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Assign inspector' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign account' });
    const select = within(dialog).getByRole('combobox', { name: /Assign account for/ });

    await within(dialog).findByRole('option', { name: 'Dana Okafor (E-1)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });
    expect(assignInspector).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm assignment' }));
    await waitFor(() => expect(assignInspector).toHaveBeenCalledWith(INSPECTION, CANDIDATE));
  });

  it('hace visible una asignación futura solo después de confirmar', async () => {
    listScheduled.mockResolvedValue([inspection({
      period_start: '2026-11-01',
      period_end: '2027-01-31',
      inspector_id: CANDIDATE,
      inspector_name: 'Dana Okafor',
    })]);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Nov 2026–Jan 2027' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make visible' }));

    const dialog = screen.getByRole('dialog', { name: 'Make inspection visible' });
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    expect(makeScheduledInspectionVisible).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make visible' }));

    await waitFor(() => expect(makeScheduledInspectionVisible).toHaveBeenCalledWith(INSPECTION));
  });

  it('mantiene el error de visibilidad dentro de la confirmación', async () => {
    listScheduled.mockResolvedValue([inspection({
      period_start: '2026-11-01',
      period_end: '2027-01-31',
      inspector_id: CANDIDATE,
      inspector_name: 'Dana Okafor',
    })]);
    makeScheduledInspectionVisible.mockRejectedValue(new Error('Inspection can no longer change visibility'));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Nov 2026–Jan 2027' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make visible' }));
    const dialog = screen.getByRole('dialog', { name: 'Make inspection visible' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make visible' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Inspection can no longer change visibility');
    expect(screen.getAllByText('Not visible').length).toBeGreaterThan(0);
  });

  it('no cancela con motivo vacío y envía un único POST con motivo', async () => {
    const opened = inspection();
    const cancelled = inspection({ status: 'cancelled', cancelled_at: '2026-02-05T00:00:00.000Z', cancellation_reason: 'Plant shutdown' });
    listScheduled.mockResolvedValueOnce([opened]).mockResolvedValueOnce([cancelled]);
    cancelScheduledInspection.mockResolvedValue(cancelled);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Feb–Apr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel period' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel Feb–Apr' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm cancellation' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Cancel with a reason'), { target: { value: '  ' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Cancel with a reason'), { target: { value: 'Plant shutdown' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(cancelScheduledInspection).toHaveBeenCalledTimes(1));
    expect(cancelScheduledInspection).toHaveBeenCalledWith(INSPECTION, 'Plant shutdown');
    expect(await screen.findByText('Cancelled: Plant shutdown')).toBeTruthy();
  });

  it('muestra el error al cancelar y conserva el estado abierto', async () => {
    listScheduled.mockResolvedValue([inspection()]);
    cancelScheduledInspection.mockRejectedValue(new Error('Period can no longer be cancelled'));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Feb–Apr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel period' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel Feb–Apr' });
    fireEvent.change(within(dialog).getByLabelText('Cancel with a reason'), { target: { value: 'Plant shutdown' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Period can no longer be cancelled');
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('ofrece reprogramar una fila cancelada y crea la nueva inspección con la versión actual', async () => {
    const cancelled = inspection({ status: 'missed', cancelled_at: '2026-02-05T00:00:00.000Z', cancellation_reason: 'Plant shutdown', template_version: 1 });
    const rescheduled = inspection();
    listScheduled.mockResolvedValueOnce([cancelled]).mockResolvedValueOnce([rescheduled]);
    createScheduledInspection.mockResolvedValue(rescheduled);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Feb–Apr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule again' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Feb–Apr again' });
    expect(within(dialog).getByText(/cancellation stays on the record/)).toBeTruthy();
    expect(within(dialog).getByText('Cancelled: Plant shutdown')).toBeTruthy();
    expect(within(dialog).getByText(/Version 2 will be frozen/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open period' }));

    await waitFor(() => expect(createScheduledInspection).toHaveBeenCalledWith({
      site_id: SITE,
      template_id: TEMPLATE,
      period_start: '2026-02-01',
      visible_early: false,
    }));
    expect(await screen.findByText('Open')).toBeTruthy();
  });

  it('mantiene el error de asignación en el diálogo del período que lo produjo', async () => {
    listScheduled.mockResolvedValue([inspection(), inspection({ id: '99999999-9999-4999-8999-999999999999', period_start: '2026-05-01', period_end: '2026-07-31' })]);
    assignInspector.mockRejectedValue(new Error('Inspector is no longer eligible'));
    renderRoute();
    const menus = await screen.findAllByRole('button', { name: /^More actions for / });
    fireEvent.click(menus[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Assign inspector' }));

    const dialog = screen.getByRole('dialog', { name: 'Assign account' });
    const select = within(dialog).getByRole('combobox', { name: /Assign account for/ });
    await within(dialog).findByRole('option', { name: 'Dana Okafor (E-1)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm assignment' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Inspector is no longer eligible');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('lee completados sin controles y ofrece reprogramar cancelados', async () => {
    listScheduled.mockResolvedValue([
      inspection({ status: 'completed', inspector_id: CANDIDATE, inspector_name: 'Dana Okafor', inspection_id: USER }),
      inspection({ id: '99999999-9999-4999-8999-999999999999', period_start: '2026-05-01', period_end: '2026-07-31', status: 'cancelled', cancelled_at: '2026-05-01T00:00:00.000Z', cancellation_reason: 'Plant shutdown' }),
    ]);
    renderRoute();

    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(screen.getByText('Dana Okafor')).toBeTruthy();
    expect(screen.getByText('Cancelled: Plant shutdown')).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1, 3);
    expect(within(rows[0]!).queryByRole('button', { name: /^More actions for / })).toBeNull();
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'More actions for May–Jul' }));
    expect(screen.getByRole('menuitem', { name: 'Schedule again' })).toBeTruthy();
  });

  it('retira cancelar y reprogramar para un lector', async () => {
    useAppSession.mockReturnValue(session('inspector'));
    listScheduled.mockResolvedValue([
      inspection(),
      inspection({ id: '99999999-9999-4999-8999-999999999999', period_start: '2026-05-01', period_end: '2026-07-31', cancelled_at: '2026-05-01T00:00:00.000Z', cancellation_reason: 'Plant shutdown' }),
    ]);
    renderRoute();

    expect(await screen.findAllByRole('row')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^More actions for / })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Assign inspector for/ })).toBeNull();
  });
});
