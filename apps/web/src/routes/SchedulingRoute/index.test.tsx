import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectionSchedule, InspectorOption, ScheduledInspection, Session, Site } from '@hs/contracts';

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

vi.mock('../../api/inspections', () => ({ listSites, listTemplates, listInspectorCandidates, listSchedules, createSchedule, updateSchedule, listScheduled, createScheduledInspection, assignInspector, cancelScheduledInspection }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(role: Session['role'], siteScope: readonly string[] = [SITE]): { account: Session } {
  return { account: { userId: USER, personId: PERSON, role, siteScope: [...siteScope], recordsFrom: null, recordsTo: null } };
}

function site(): Site {
  return { id: SITE, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null };
}

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return { id: RULE, site_id: SITE, template_id: TEMPLATE, template_name: 'Monthly general workplace inspection', frequency_months: 1, anchor_month: 1, default_inspector_id: null, default_inspector_name: null, created_at: '2020-01-01T00:00:00.000Z', deactivated_at: null, ...overrides };
}

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return { id: SCHEDULED, site_id: SITE, period_start: '2026-08-01', period_months: 1, period_end: '2026-08-31', template_id: TEMPLATE, template_name: 'Monthly general workplace inspection', template_version_id: VERSION, template_version: 2, inspector_id: null, inspector_name: null, scheduled_at: '2026-08-01T07:00:00.000Z', scheduled_by: null, cancelled_at: null, cancellation_reason: null, status: 'open', inspection_id: null, completed_at: null, ...overrides };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SchedulingRoute /></QueryClientProvider>);
}

beforeEach(() => {
  listSites.mockReset().mockResolvedValue([site()]);
  listTemplates.mockReset().mockResolvedValue([
    { id: TEMPLATE, key: 'monthly', name: 'Monthly general workplace inspection', latest_version: 2, latest_version_id: VERSION, latest_published_at: '2026-01-01' },
    { id: OTHER_TEMPLATE, key: 'quarterly', name: 'Quarterly electrical inspection', latest_version: 1, latest_version_id: OTHER_VERSION, latest_published_at: '2026-01-01' },
  ]);
  listInspectorCandidates.mockReset().mockResolvedValue([{ id: CANDIDATE, employee_number: 'E-4471', first_name: 'Dana', last_name: 'Okafor' } satisfies InspectorOption]);
  listSchedules.mockReset().mockResolvedValue([rule()]);
  createSchedule.mockReset().mockResolvedValue(rule());
  updateSchedule.mockReset().mockResolvedValue(rule({ deactivated_at: '2026-08-05T00:00:00.000Z' }));
  listScheduled.mockReset().mockResolvedValue([inspection()]);
  createScheduledInspection.mockReset().mockResolvedValue(inspection({ period_start: '2027-12-01', period_end: '2027-12-31', inspector_id: CANDIDATE }));
  assignInspector.mockReset().mockResolvedValue(inspection({ inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' }));
  cancelScheduledInspection.mockReset().mockResolvedValue(inspection({ status: 'cancelled', cancelled_at: '2026-08-05T00:00:00.000Z', cancellation_reason: 'Plant shutdown' }));
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.innerWidth = 1024;
});

describe('la superficie anual', () => {
  it('presenta requirements, matrix y una entrada por periodo sin UUID', async () => {
    const { container } = renderRoute();

    expect(await screen.findByRole('heading', { name: 'Annual schedule' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Inspection requirements/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Matrix/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /August/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('inicializa la lista en viewport pequeño y conserva la entrada al cambiar de vista', async () => {
    window.innerWidth = 375;
    renderRoute();

    expect((await screen.findByRole('button', { name: /List/ })).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Matrix/ }));
    expect(screen.getByRole('button', { name: /August/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /List/ }));
    expect(screen.getByRole('button', { name: /August.*Monthly/ })).toBeTruthy();
  });

  it('filtra desde el resumen y lo limpia sin cambiar sus conteos anuales', async () => {
    renderRoute();
    const unassigned = await screen.findByRole('button', { name: /Unassigned \(1\)/ });
    fireEvent.click(unassigned);
    expect(screen.getByRole('button', { name: /August/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /January/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: /January/ })).toBeTruthy();
  });

  it('muestra un año futuro completamente no abierto', async () => {
    renderRoute();
    const current = new Date().getFullYear();
    fireEvent.click(await screen.findByRole('button', { name: `${current + 1} →` }));
    expect(await within(screen.getByRole('region', { name: /schedule matrix/ })).findAllByRole('button', { name: /Not opened/ })).toHaveLength(12);
  });
});

describe('detalle y operaciones de periodo', () => {
  it('no asigna hasta confirmar explícitamente', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: /August/ }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText('Inspector');
    await within(select).findByRole('option', { name: 'Dana Okafor (E-4471)' });
    fireEvent.change(select, { target: { value: CANDIDATE } });
    expect(assignInspector).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm assignment' }));
    await waitFor(() => expect(assignInspector).toHaveBeenCalledWith(SCHEDULED, CANDIDATE));
  });

  it('abre un periodo futuro y congela la versión publicada mostrada', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: `${new Date().getFullYear() + 1} →` }));
    fireEvent.click((await screen.findAllByRole('button', { name: /December/ }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Version 2 will be frozen/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open this period' }));
    await waitFor(() => expect(createScheduledInspection).toHaveBeenCalledWith({ site_id: SITE, template_id: TEMPLATE, period_start: `${new Date().getFullYear() + 1}-12-01`, inspector_id: null }));
  });

  it('cancela desde el detalle con motivo y conserva la lectura de missed', async () => {
    listScheduled.mockResolvedValue([inspection({ status: 'missed', inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' })]);
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: /August/ }));
    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText(/can still be submitted/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: 'Cancel period' }));
    const cancel = await screen.findByRole('dialog', { name: 'Cancel period' });
    fireEvent.change(within(cancel).getByLabelText('Cancel with a reason'), { target: { value: 'Plant shutdown' } });
    fireEvent.click(within(cancel).getByRole('button', { name: 'Confirm cancellation' }));
    await waitFor(() => expect(cancelScheduledInspection).toHaveBeenCalledWith(SCHEDULED, 'Plant shutdown'));
  });
});

describe('requirements y permisos', () => {
  it('crea una regla no mensual con inspector por defecto y anchor', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add requirement' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Template');
    fireEvent.change(within(dialog).getByLabelText('Template'), { target: { value: OTHER_TEMPLATE } });
    fireEvent.change(within(dialog).getByLabelText('Frequency'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Starting month'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText(/Default inspector/), { target: { value: CANDIDATE } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith({ site_id: SITE, template_id: OTHER_TEMPLATE, frequency_months: 3, anchor_month: 2, default_inspector_id: CANDIDATE }));
  });

  it('un miembro del JHSC lee requirements y periodos sin controles de escritura', async () => {
    useAppSession.mockReturnValue(session('jhsc_member'));
    renderRoute();
    expect(await screen.findByText('Default inspector: None')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add requirement' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /August/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel period|Confirm assignment|Open this period/ })).toBeNull();
  });

  it('distingue error de plantillas del vacío de plantillas', async () => {
    listTemplates.mockRejectedValue(new Error('connection failed'));
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add requirement' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/could not be loaded/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Add requirement' }).hasAttribute('disabled')).toBe(true);
  });
});
