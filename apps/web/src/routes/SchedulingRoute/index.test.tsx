import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectionSchedule, InspectorOption, ScheduledInspection, Session, Site } from '@hs/contracts';

import { SchedulingRoute } from './index';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: React.ReactNode; params?: { scheduleId?: string } }) => (
    <a href={params?.scheduleId ? `/scheduling/${params.scheduleId}` : '/scheduling'}>{children}</a>
  ),
}));

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
const ARCHIVED_RULE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const listSites = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const listInspectorCandidates = vi.hoisted(() => vi.fn());
const listSchedules = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const updateSchedule = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites, listTemplates, listInspectorCandidates, listSchedules, createSchedule, updateSchedule, listScheduled }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(role: Session['role'], siteScope: readonly string[] = [SITE]): { account: Session } {
  return { account: { userId: USER, personId: PERSON, role, siteScope: [...siteScope], recordsFrom: null, recordsTo: null } };
}

function site(): Site {
  return { id: SITE, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null };
}

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return { id: RULE, site_id: SITE, template_id: TEMPLATE, template_name: 'Monthly general workplace inspection', frequency_months: 1, anchor_month: 1, default_inspector_id: null, default_inspector_name: null, created_at: '2020-01-01T00:00:00.000Z', deactivated_at: null, archived_at: null, ...overrides };
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
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('la superficie anual', () => {
  it('presenta requirements, matrix y una entrada por periodo sin UUID', async () => {
    const { container } = renderRoute();

    expect(await screen.findByRole('heading', { name: 'Annual schedule' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Inspection requirements/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /August/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  // La casilla dibuja un ícono y nada más: sin la leyenda, el color no dice qué significa.
  it('explica en la leyenda cada estado que la matriz dibuja', async () => {
    renderRoute();

    await screen.findByRole('heading', { name: 'Annual schedule' }, { timeout: 5000 });
    const legend = screen.getByRole('list', { name: 'Status legend' });

    expect(within(legend).getByText('Not due')).toBeTruthy();
    expect(within(legend).getByText('Not opened')).toBeTruthy();
    expect(within(legend).getByText('Open')).toBeTruthy();
    expect(within(legend).getByText('Completed')).toBeTruthy();
    expect(within(legend).getByText('Missed')).toBeTruthy();
    expect(within(legend).queryByText('Cancelled')).toBeNull();
  });

  it('muestra un año futuro completamente no abierto', async () => {
    renderRoute();
    const current = new Date().getFullYear();
    fireEvent.click(await screen.findByRole('button', { name: `Go to ${current + 1}` }));
    expect(await within(screen.getByRole('region', { name: /schedule matrix/ })).findAllByRole('button', { name: /Not opened/ })).toHaveLength(12);
  });
});

describe('detalle de periodo', () => {
  it('el detalle de un periodo abierto solo informa', async () => {
    listScheduled.mockResolvedValue([inspection({ status: 'missed', inspector_id: CANDIDATE, inspector_name: 'Dana Okafor' })]);
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: /August/ }));
    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('Missed')).toBeTruthy();
    expect(within(detail).getByText('Dana Okafor')).toBeTruthy();
    expect(within(detail).getByText(/can still be submitted/)).toBeTruthy();
    expect(within(detail).queryByLabelText('Inspector')).toBeNull();
    expect(within(detail).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
  });

  it('el detalle de un periodo no abierto nombra la version publicada sin poder abrirlo', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: `Go to ${new Date().getFullYear() + 1}` }));
    fireEvent.click((await screen.findAllByRole('button', { name: /December/ }))[0]!);
    const detail = await screen.findByRole('dialog');
    expect(await within(detail).findByText(/Version 2 would be frozen/)).toBeTruthy();
    expect(within(detail).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
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
    listSchedules.mockResolvedValue([
      rule(),
      rule({ id: ARCHIVED_RULE, template_name: 'Archived workplace inspection', deactivated_at: '2025-01-01T00:00:00.000Z', archived_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    useAppSession.mockReturnValue(session('jhsc_member'));
    renderRoute();
    const requirements = await screen.findByRole('table', { name: 'Inspection requirements' });
    expect(within(requirements).getByRole('columnheader', { name: 'Default inspector' })).toBeTruthy();
    expect(within(requirements).getAllByRole('cell', { name: 'None' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add requirement' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByLabelText('Show archived')).toBeNull();
    expect(screen.getByText('Archived workplace inspection')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Archived workplace inspection' }).getAttribute('href')).toBe(`/scheduling/${ARCHIVED_RULE}`);
    fireEvent.click(screen.getByRole('button', { name: /August/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('muestra solo el menú de acciones en cada requisito', async () => {
    renderRoute();
    const requirements = await screen.findByRole('table', { name: 'Inspection requirements' });
    expect(within(requirements).getByRole('columnheader', { name: 'Frequency' })).toBeTruthy();
    expect(within(requirements).getByRole('cell', { name: 'Monthly' })).toBeTruthy();
    expect(within(requirements).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(requirements).getByRole('button', { name: /More actions/ })).toBeTruthy();
  });

  it('distingue error de plantillas del vacío de plantillas', async () => {
    listTemplates.mockRejectedValue(new Error('connection failed'));
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Add requirement' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/could not be loaded/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Add requirement' }).hasAttribute('disabled')).toBe(true);
  });

  it('oculta archivadas por defecto y permite mostrarlas como filas independientes', async () => {
    listSchedules.mockResolvedValue([
      rule(),
      rule({ id: ARCHIVED_RULE, template_name: 'Archived workplace inspection', deactivated_at: '2025-01-01T00:00:00.000Z', archived_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    renderRoute();

    const toggle = await screen.findByLabelText('Show archived');
    expect(screen.queryByText('Archived workplace inspection')).toBeNull();
    fireEvent.click(toggle);

    const requirements = screen.getByRole('table', { name: 'Inspection requirements' });
    expect(within(requirements).getByText('Archived workplace inspection')).toBeTruthy();
    expect(within(requirements).getByText('Archived')).toBeTruthy();
    expect(within(requirements).getAllByRole('row')).toHaveLength(3);
  });

  it('confirma el archivo solo para una regla desactivada', async () => {
    listSchedules.mockResolvedValue([
      rule({ deactivated_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive requirement' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive requirement' });
    expect(within(dialog).getByText(/past obligations and scheduled inspections remain unchanged/)).toBeTruthy();
    expect(updateSchedule).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive requirement' }));
    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith(RULE, { archived: true }));
  });

  it('permite reactivar una regla desde el menú de tres puntos', async () => {
    listSchedules.mockResolvedValue([rule({ deactivated_at: '2026-01-01T00:00:00.000Z' })]);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivate requirement' }));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith(RULE, { deactivated: false }));
  });

  it('no ofrece archivo para una regla activa', async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: /More actions/ }));
    expect(screen.queryByRole('menuitem', { name: 'Archive requirement' })).toBeNull();
  });

  it('restaura sin reactivar y muestra los rechazos del servidor', async () => {
    listSchedules.mockResolvedValue([
      rule({ id: ARCHIVED_RULE, deactivated_at: '2025-01-01T00:00:00.000Z', archived_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    updateSchedule.mockRejectedValueOnce(new Error('Another non-archived requirement exists'));
    renderRoute();

    fireEvent.click(await screen.findByLabelText('Show archived'));
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith(ARCHIVED_RULE, { archived: false }));
    expect((await screen.findByRole('alert')).textContent).toContain('Another non-archived requirement exists');
    expect(screen.getByText('Archived')).toBeTruthy();
  });
});
