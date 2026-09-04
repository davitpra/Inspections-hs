import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoricalInspectionsRoute } from './index';

const listScheduled = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listScheduled, listSites }));
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
const OTHER_SITE = '44444444-4444-4444-8444-444444444444';

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
      <HistoricalInspectionsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppSession.mockReturnValue({ account: { userId: USER }, ready: true });
  listSites.mockResolvedValue([
    { id: SITE, name: 'Glencoe' },
    { id: OTHER_SITE, name: 'St. Thomas' },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HistoricalInspectionsRoute', () => {
  it('presenta una tabla por template_id, ordenadas por nombre y con períodos recientes primero', async () => {
    listScheduled.mockResolvedValue([
      scheduled({
        id: 'quarterly',
        template_id: 't-quarterly',
        template_name: 'Quarterly equipment inspection',
        site_id: OTHER_SITE,
      }),
      scheduled({ id: 'monthly-july' }),
      scheduled({
        id: 'monthly-may',
        period_start: '2027-05-01',
        completed_at: '2027-05-30T18:00:00.000Z',
      }),
    ]);

    renderRoute();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    // El conteo va dentro del `<h2>`, así que es parte del nombre con que se anuncia.
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Monthly workplace inspection (2)',
      'Quarterly equipment inspection (1)',
    ]);

    const monthly = screen.getByRole('table', {
      name: 'Monthly workplace inspection completed inspections',
    });
    expect(within(monthly).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'July 2027',
      'May 2027',
    ]);
    expect(within(monthly).getAllByText('Glencoe')).toHaveLength(2);
    expect(
      within(monthly).getAllByRole('link', { name: /View report/ })[0]?.getAttribute('href'),
    ).toBe('/inspections/monthly-july/report');

    const quarterly = screen.getByRole('table', {
      name: 'Quarterly equipment inspection completed inspections',
    });
    expect(within(quarterly).getByText('St. Thomas')).toBeTruthy();
  });

  it('mantiene separados dos template_id aunque tengan el mismo nombre', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'first', template_id: 't-first' }),
      scheduled({ id: 'second', template_id: 't-second' }),
    ]);

    renderRoute();

    // Por `textContent` y no por `name`: el nombre accesible que calcula la librería de
    // pruebas junta los nodos sin el espacio que el navegador sí conserva, y fijar eso
    // acá sería fijar la rareza de la herramienta en vez de lo que se lee en pantalla.
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Monthly workplace inspection (1)',
      'Monthly workplace inspection (1)',
    ]);
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('no cuenta lo que completó otro inspector ni un período pendiente', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine' }),
      scheduled({
        id: 'theirs',
        template_id: 'other',
        template_name: 'Other inspection',
        inspector_id: OTHER,
      }),
      scheduled({
        id: 'open',
        template_id: 'open',
        template_name: 'Open inspection',
        status: 'open',
        inspection_id: null,
      }),
    ]);

    renderRoute();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('Other inspection')).toBeNull();
    expect(screen.queryByText('Open inspection')).toBeNull();
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

  it('si no puede resolver los sitios no muestra tablas con identificadores crudos', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listSites.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Historical inspections need a connection/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(SITE)).toBeNull();
  });
});
