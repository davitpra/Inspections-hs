import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoricalInspectionsRoute } from './index';

const listScheduled = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listScheduled }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
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

function scheduled(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    site_id: '33333333-3333-4333-8333-333333333333',
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
      <HistoricalInspectionsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppSession.mockReturnValue({ account: { userId: USER }, ready: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HistoricalInspectionsRoute', () => {
  it('presenta un tipo por template_id, su conteo y su enlace, ordenados por nombre', async () => {
    listScheduled.mockResolvedValue([
      scheduled({
        id: 'quarterly',
        template_id: 't-quarterly',
        template_name: 'Quarterly equipment inspection',
      }),
      scheduled({ id: 'monthly-july' }),
      scheduled({ id: 'monthly-may', period_start: '2027-05-01' }),
    ]);

    renderRoute();

    const table = await screen.findByRole('table', { name: 'Completed inspection types' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Monthly workplace inspection',
      'Quarterly equipment inspection',
    ]);
    expect(within(rows[0]!).getByText('2')).toBeTruthy();
    expect(
      within(rows[0]!).getByRole('link', { name: 'Monthly workplace inspection' }).getAttribute('href'),
    ).toBe('/historical/t-monthly');
  });

  it('mantiene separados dos template_id aunque tengan el mismo nombre', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'first', template_id: 't-first' }),
      scheduled({ id: 'second', template_id: 't-second' }),
    ]);

    renderRoute();

    expect(await screen.findAllByRole('link', { name: 'Monthly workplace inspection' })).toHaveLength(2);
  });

  it('no cuenta lo que completó otro inspector ni un período pendiente', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine' }),
      scheduled({ id: 'theirs', template_id: 'other', inspector_id: OTHER }),
      scheduled({ id: 'open', template_id: 'open', status: 'open', inspection_id: null }),
    ]);

    renderRoute();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('other')).toBeNull();
  });

  it('muestra el estado vacío solo cuando la consulta terminó', async () => {
    listScheduled.mockResolvedValue([]);

    renderRoute();

    expect(await screen.findByText('You have not completed any inspections yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('sin red lo dice y no finge un historial vacío', async () => {
    listScheduled.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Historical inspections need a connection/)).toBeTruthy();
    expect(screen.queryByText('You have not completed any inspections yet.')).toBeNull();
  });
});
