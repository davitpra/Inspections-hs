import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindingsRoute } from './index';

const listScheduled = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const listFindings = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listScheduled, listSites }));
vi.mock('../../api/findings', () => ({ listFindings }));
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

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    site_id: SITE,
    origin: 'inspection',
    state: 'raised',
    inspection_id: 'insp-1',
    template_version_item_id: 'tvi-1',
    item_key: 'exits.clear',
    location_id: null,
    description: 'The east exit was blocked by pallets.',
    photo_object_keys: [],
    reported_by: USER,
    occurred_at: '2027-07-29T18:00:00.000Z',
    recorded_at: '2027-07-29T18:05:00.000Z',
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <FindingsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppSession.mockReturnValue({ account: { userId: USER }, ready: true });
  listSites.mockResolvedValue([{ id: SITE, name: 'Glencoe' }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FindingsRoute', () => {
  it('presenta una tabla por tipo sin duplicar inspecciones con varios hallazgos', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'july', inspection_id: 'insp-july' }),
      scheduled({ id: 'may', period_start: '2027-05-01', inspection_id: 'insp-may' }),
      scheduled({
        id: 'quarterly',
        inspection_id: 'insp-quarterly',
        template_id: 't-quarterly',
        template_name: 'Quarterly equipment inspection',
      }),
    ]);
    listFindings.mockResolvedValue([
      finding({ inspection_id: 'insp-july' }),
      finding({ id: 'f-2', inspection_id: 'insp-july' }),
      finding({ id: 'f-3', inspection_id: 'insp-may' }),
      finding({ id: 'f-4', inspection_id: 'insp-quarterly' }),
    ]);

    renderRoute();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    // El conteo va dentro del `<h2>`, así que es parte del nombre con que se anuncia.
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Monthly workplace inspection (2)',
      'Quarterly equipment inspection (1)',
    ]);

    const monthly = screen.getByRole('table', {
      name: 'Monthly workplace inspection inspections with findings',
    });
    expect(within(monthly).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'July 2027',
      'May 2027',
    ]);
    expect(within(monthly).getAllByText('Glencoe')).toHaveLength(2);
    expect(
      within(monthly).getAllByRole('link', { name: /View findings/ })[0]?.getAttribute('href'),
    ).toBe('/findings/july');

    expect(
      screen.getByRole('table', {
        name: 'Quarterly equipment inspection inspections with findings',
      }),
    ).toBeTruthy();
  });

  it('excluye inspecciones limpias, pendientes y completadas por otra cuenta', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine', inspection_id: 'insp-mine' }),
      scheduled({ id: 'clean', template_id: 'clean', inspection_id: 'insp-clean' }),
      scheduled({ id: 'theirs', template_id: 'theirs', inspection_id: 'insp-theirs', inspector_id: OTHER }),
      scheduled({ id: 'open', template_id: 'open', inspection_id: 'insp-open', status: 'open' }),
    ]);
    listFindings.mockResolvedValue([
      finding({ inspection_id: 'insp-mine' }),
      finding({ id: 'f-theirs', inspection_id: 'insp-theirs' }),
      finding({ id: 'f-open', inspection_id: 'insp-open' }),
    ]);

    renderRoute();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('no crea una entrada para un hallazgo manual', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockResolvedValue([
      finding({ origin: 'manual', inspection_id: null, item_key: null }),
    ]);

    renderRoute();

    expect(
      await screen.findByText('None of the inspections you completed recorded a finding.'),
    ).toBeTruthy();
  });

  it('solo declara vacío cuando ambas consultas terminaron', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockResolvedValue([]);

    renderRoute();

    expect(
      await screen.findByText('None of the inspections you completed recorded a finding.'),
    ).toBeTruthy();
  });

  it.each([
    ['findings', () => listFindings.mockRejectedValue(new Error('offline'))],
    ['inspections', () => listScheduled.mockRejectedValue(new Error('offline'))],
    ['sites', () => listSites.mockRejectedValue(new Error('offline'))],
  ])('si falla la consulta de %s informa que necesita conexión', async (_, reject) => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockResolvedValue([finding()]);
    reject();

    renderRoute();

    expect(await screen.findByText(/Findings need a connection/)).toBeTruthy();
    expect(
      screen.queryByText('None of the inspections you completed recorded a finding.'),
    ).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
