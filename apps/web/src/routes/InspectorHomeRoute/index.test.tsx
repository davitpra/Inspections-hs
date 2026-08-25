import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorHomeRoute } from './index';

const listPendingInspections = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const listTemplates = vi.hoisted(() => vi.fn());
const listDrafts = vi.hoisted(() => vi.fn());
const discardDraft = vi.hoisted(() => vi.fn());
const missingForField = vi.hoisted(() => vi.fn());
const prefetchInspection = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => vi.fn(() => ({}) as { submitted?: 'accepted' }));

vi.mock('../../api/inspections', () => ({
  listPendingInspections,
  listSites,
  listScheduled,
  listTemplates,
}));
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  listDrafts,
  discardDraft,
}));
vi.mock('../../offline/prefetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/prefetch')>()),
  missingForField,
  prefetchInspection,
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('../../app/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search(),
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: INSPECTION,
    site_id: SITE,
    period_start: '2026-08-01',
    period_months: 1 as const,
    period_end: '2026-08-31',
    template_name: 'Monthly general workplace inspection',
    template_version_id: VERSION,
    template_version: 2,
    latest_template_version: 2,
    latest_template_version_id: VERSION,
    overdue: false,
    ...overrides,
  };
}

function scheduled(overrides: Record<string, unknown> = {}) {
  return {
    id: INSPECTION,
    site_id: SITE,
    period_start: '2026-08-01',
    period_months: 1 as const,
    period_end: '2026-08-31',
    template_id: '55555555-5555-4555-8555-555555555555',
    template_name: 'Monthly general workplace inspection',
    template_version_id: VERSION,
    template_version: 2,
    inspector_id: USER,
    inspector_name: 'Inspector One',
    scheduled_at: '2026-08-01T07:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'open' as const,
    inspection_id: null,
    completed_at: null,
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    client_submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scheduled_inspection_id: INSPECTION,
    account_id: USER,
    site_id: SITE,
    template_version_id: VERSION,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    status: 'capturing' as const,
    signed_at: null,
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InspectorHomeRoute />
    </QueryClientProvider>,
  );
}

describe('InspectorHomeRoute', () => {
  beforeEach(() => {
    listPendingInspections.mockResolvedValue([pending()]);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listScheduled.mockResolvedValue([]);
    listTemplates.mockResolvedValue([]);
    listDrafts.mockResolvedValue([]);
    discardDraft.mockResolvedValue(true);
    missingForField.mockResolvedValue([]);
    useAppSession.mockReturnValue({ account: { userId: USER, siteScope: [SITE] } });
    search.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('es la lista principal y cada inspección abre su detalle, no captura', async () => {
    listPendingInspections.mockResolvedValue([
      pending({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', template_name: 'First requirement' }),
      pending({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', template_name: 'Second requirement' }),
    ]);

    renderRoute();

    expect(await screen.findByText('(2)')).toBeTruthy();
    const second = screen.getByRole('link', { name: 'Second requirement' });
    expect(second.getAttribute('href')).toBe('/inspections/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(screen.queryByRole('link', { name: 'Start inspection' })).toBeNull();
    expect((await screen.findAllByRole('link', { name: 'View inspection' }))[0]?.getAttribute('href')).toBe(
      '/inspections/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('conserva el acuse de un envío aceptado y el acceso al historial', async () => {
    search.mockReturnValue({ submitted: 'accepted' });

    renderRoute();

    expect(await screen.findByText(/sent and accepted/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View past inspections' }).getAttribute('href')).toBe(
      '/inspections/past',
    );
  });

  it('muestra estado vacío y error de conexión', async () => {
    listPendingInspections.mockResolvedValueOnce([]);
    renderRoute();
    expect(await screen.findByText('Nothing is scheduled for you.')).toBeTruthy();

    cleanup();
    listPendingInspections.mockRejectedValueOnce(new Error('offline'));
    renderRoute();
    expect((await screen.findByRole('alert')).textContent).toMatch(/need a connection/);
  });

  it('descarga en la lista y después abre el detalle como siguiente acción', async () => {
    missingForField.mockResolvedValueOnce(['roster']).mockResolvedValue([]);
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations', 'roster'],
      missing: [],
      errors: {},
    });

    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Download for the field' }));

    await waitFor(() =>
      expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION, { advance: true }),
    );
    const detail = await screen.findByRole('link', { name: 'View inspection' });
    expect(detail.getAttribute('href')).toBe(`/inspections/${INSPECTION}`);
    expect(screen.queryByRole('button', { name: 'Update offline data' })).toBeNull();
  });

  it('no ofrece una acción operativa antes de resolver el dispositivo', async () => {
    missingForField.mockReturnValue(new Promise(() => undefined));
    renderRoute();

    await screen.findByText('Loading…');
    const pendingTable = screen.getByRole('table', { name: 'Scheduled inspections' });
    expect(within(pendingTable).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: 'View inspection' })).toBeNull();
    expect(screen.getByRole('link', { name: pending().template_name })).toBeTruthy();
  });

  it('conserva los borradores locales y su confirmación de descarte', async () => {
    listDrafts.mockResolvedValue([draft()]);
    renderRoute();

    await screen.findByText('Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Discard the draft started 2026-08-01' }));
    expect(screen.getByRole('button', { name: 'Discard the draft' })).toBeTruthy();
    expect(screen.getByText(/no copy to bring back/)).toBeTruthy();
  });

  it('muestra en el calendario anual todos los estados propios y permite leer su detalle', async () => {
    listScheduled.mockResolvedValue([
      scheduled(),
      scheduled({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
        status: 'completed',
        completed_at: '2026-07-31T15:00:00.000Z',
      }),
      scheduled({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        status: 'cancelled',
        cancelled_at: '2026-06-05T12:00:00.000Z',
        cancellation_reason: 'Site closed',
      }),
      scheduled({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        period_start: '2026-05-01',
        inspector_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        template_name: 'Another inspector requirement',
      }),
    ]);

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'My annual schedule' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /August, Open/ })).toBeTruthy();
    const completed = screen.getByRole('button', { name: /July, Completed/ });
    expect(screen.getByRole('button', { name: /June, Cancelled/ })).toBeTruthy();
    expect(screen.queryByText('Another inspector requirement')).toBeNull();

    fireEvent.click(completed);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Completed');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Go to 2027' }));
    expect(await screen.findByText('No assigned inspections in this year.')).toBeTruthy();
  });

  it('distingue el error de conexión del calendario de un año vacío', async () => {
    listScheduled.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect((await screen.findByText('Your annual schedule needs a connection.')).getAttribute('role')).toBe(
      'alert',
    );
    expect(screen.queryByText('No assigned inspections in this year.')).toBeNull();
  });
});
