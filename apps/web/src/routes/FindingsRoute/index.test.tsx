import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindingsRoute } from './index';

const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const listFindings = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites, listScheduled }));
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

/** El `$id` del `to` resuelto con los `params`, como haría el router de verdad. */
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
    template_id: 't-1',
    template_name: 'Monthly general workplace inspection',
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
  listFindings.mockResolvedValue([finding()]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FindingsRoute', () => {
  it('lista la inspección que dejó un hallazgo, con su fecha de cierre', async () => {
    listScheduled.mockResolvedValue([scheduled()]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.getByText('Jul 29, 2027')).toBeTruthy();
    expect(screen.getByText('Monthly general workplace inspection')).toBeTruthy();
  });

  /** Lo que separa esta pantalla del historial: un período limpio no es una fila. */
  it('no lista la inspección que se cerró sin hallazgos', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'july', period_start: '2027-07-01', inspection_id: 'insp-1' }),
      scheduled({ id: 'may', period_start: '2027-05-01', inspection_id: 'insp-clean' }),
    ]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.queryByText('May 2027')).toBeNull();
  });

  /** El recorte por cuenta es el mismo del historial: `listScheduled` trae toda la planta. */
  it('no lista lo que completó otro inspector', async () => {
    listScheduled.mockResolvedValue([scheduled({ inspector_id: OTHER })]);
    listFindings.mockResolvedValue([finding()]);

    renderRoute();

    expect(
      await screen.findByText('None of the inspections you completed recorded a finding.'),
    ).toBeTruthy();
  });

  it('abre los hallazgos de cada envío por su inspección programada', async () => {
    listScheduled.mockResolvedValue([scheduled({ id: 'july' })]);

    renderRoute();

    const link = await screen.findByRole(
      'link',
      { name: 'View findings' },
      { timeout: 3_000 },
    );
    expect(link.getAttribute('href')).toBe('/findings/july');
  });

  it('lo dice cuando ninguna inspección dejó hallazgos', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockResolvedValue([]);

    renderRoute();

    expect(
      await screen.findByText('None of the inspections you completed recorded a finding.'),
    ).toBeTruthy();
  });

  /**
   * Con los hallazgos caídos la lista da vacío igual, y eso NO es una planta limpia. Decir
   * que no hay nada que arreglar porque no se pudo preguntar sería el peor error posible
   * de esta pantalla.
   */
  it('sin hallazgos por red avisa, y no declara la planta limpia', async () => {
    listScheduled.mockResolvedValue([scheduled()]);
    listFindings.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Findings need a connection/)).toBeTruthy();
    expect(
      screen.queryByText('None of the inspections you completed recorded a finding.'),
    ).toBeNull();
  });

  it('sin inspecciones por red avisa igual', async () => {
    listScheduled.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Findings need a connection/)).toBeTruthy();
  });
});
