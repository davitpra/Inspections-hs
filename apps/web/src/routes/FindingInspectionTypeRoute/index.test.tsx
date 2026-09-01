import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindingInspectionTypeRoute } from './index';

const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const listFindings = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const useParams = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites, listScheduled }));
vi.mock('../../api/findings', () => ({ listFindings }));
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
      <FindingInspectionTypeRoute />
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

describe('FindingInspectionTypeRoute', () => {
  it('lista solo inspecciones del tipo elegido con hallazgos, más reciente primero', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'july', inspection_id: 'insp-july' }),
      scheduled({ id: 'may', period_start: '2027-05-01', inspection_id: 'insp-may' }),
      scheduled({ id: 'clean', period_start: '2027-06-01', inspection_id: 'insp-clean' }),
      scheduled({ id: 'other', template_id: 'other', inspection_id: 'insp-other' }),
    ]);
    listFindings.mockResolvedValue([
      finding({ inspection_id: 'insp-july' }),
      finding({ id: 'f-may', inspection_id: 'insp-may' }),
      finding({ id: 'f-other', inspection_id: 'insp-other' }),
    ]);

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Monthly workplace inspection' })).toBeTruthy();
    expect(screen.getAllByText('Glencoe')).toHaveLength(2);
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'July 2027',
      'May 2027',
    ]);
    expect(screen.queryByText('June 2027')).toBeNull();
  });

  it('excluye una inspección con hallazgos completada por otra cuenta', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine', inspection_id: 'insp-mine' }),
      scheduled({ id: 'theirs', period_start: '2027-06-01', inspection_id: 'insp-theirs', inspector_id: OTHER }),
    ]);
    listFindings.mockResolvedValue([
      finding({ inspection_id: 'insp-mine' }),
      finding({ id: 'f-theirs', inspection_id: 'insp-theirs' }),
    ]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.queryByText('June 2027')).toBeNull();
  });

  it('abre el detalle existente usando el id de inspección programada', async () => {
    listScheduled.mockResolvedValue([scheduled({ id: 'july' })]);
    listFindings.mockResolvedValue([finding()]);

    renderRoute();

    const link = await screen.findByRole('link', { name: /View findings/ });
    expect(link.getAttribute('href')).toBe('/findings/july');
  });

  it('no revela un tipo sin inspecciones con hallazgos visibles', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ template_id: 'other' }),
      scheduled({ inspector_id: OTHER }),
    ]);
    listFindings.mockResolvedValue([finding()]);

    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Inspection type not found' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it.each([
    ['sites', () => listSites.mockRejectedValue(new Error('offline'))],
    ['inspections', () => listScheduled.mockRejectedValue(new Error('offline'))],
    ['findings', () => listFindings.mockRejectedValue(new Error('offline'))],
  ])('si falla la consulta de %s no muestra una tabla parcial', async (_, reject) => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockResolvedValue([finding()]);
    reject();

    renderRoute();

    expect(await screen.findByText(/Findings need a connection/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
