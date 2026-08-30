import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoricalInspectionTypeRoute } from './index';

const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const useParams = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites, listScheduled }));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  useParams,
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

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

function scheduled(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    site_id: SITE,
    period_start: '2027-07-01',
    period_months: 1,
    period_end: '2027-07-31',
    template_id: 't-monthly',
    template_name: 'Monthly workplace inspection',
    template_version_id: 'v-1',
    template_version: 1,
    inspector_id: USER,
    inspector_name: 'Marie Tremblay',
    scheduled_at: '2027-07-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'completed',
    inspection_id: 'insp-1',
    completed_at: '2027-07-29T18:00:00.000Z',
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HistoricalInspectionTypeRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useParams.mockReturnValue({ templateId: 't-monthly' });
  useAppSession.mockReturnValue({ account: { userId: USER }, ready: true });
  listSites.mockResolvedValue([{ id: SITE, name: 'Glencoe' }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HistoricalInspectionTypeRoute', () => {
  it('lista solo el tipo elegido, con sitio y fecha, más reciente primero', async () => {
    listScheduled.mockResolvedValue([
      scheduled({
        id: 'other-type',
        template_id: 't-quarterly',
        template_name: 'Quarterly inspection',
      }),
      scheduled({ id: 'may', period_start: '2027-05-01', completed_at: '2027-05-30T18:00:00.000Z' }),
      scheduled({ id: 'july' }),
    ]);

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Monthly workplace inspection' })).toBeTruthy();
    expect(screen.getAllByText('Glencoe')).toHaveLength(2);
    expect(screen.queryByText('Quarterly inspection')).toBeNull();
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'July 2027',
      'May 2027',
    ]);
  });

  it('no muestra inspecciones del mismo tipo completadas por otra cuenta', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine' }),
      scheduled({ id: 'theirs', period_start: '2027-06-01', inspector_id: OTHER }),
    ]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.queryByText('June 2027')).toBeNull();
  });

  it('enlaza cada envío legible a su reporte', async () => {
    listScheduled.mockResolvedValue([scheduled({ id: 'july' })]);

    renderRoute();

    const report = await screen.findByRole('link', { name: /View report/ });
    expect(report.getAttribute('href')).toBe('/inspections/july/report');
  });

  it('no ofrece reporte cuando el período no tiene envío visible', async () => {
    listScheduled.mockResolvedValue([scheduled({ inspection_id: null })]);

    renderRoute();

    await screen.findByText('July 2027');
    expect(screen.queryByRole('link', { name: /View report/ })).toBeNull();
  });

  it('no revela un tipo sin inspecciones completas visibles para la cuenta', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ template_id: 'other' }),
      scheduled({ inspector_id: OTHER }),
    ]);

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Inspection type not found' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('si falla cualquiera de sus lecturas informa que necesita conexión', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listSites.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Inspection history needs a connection/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
