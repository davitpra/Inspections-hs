import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PastInspectionsRoute } from './index';

const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites, listScheduled }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

function scheduled(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    site_id: SITE,
    period_start: '2027-07-01',
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
      <PastInspectionsRoute />
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

describe('PastInspectionsRoute', () => {
  it('lista lo completado con su fecha de cierre, lo más reciente primero', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'may', period_start: '2027-05-01', completed_at: '2027-05-30T18:00:00.000Z' }),
      scheduled({ id: 'july', period_start: '2027-07-01', completed_at: '2027-07-29T18:00:00.000Z' }),
    ]);

    renderRoute();

    expect(await screen.findByText('Completed on Jul 29, 2027')).toBeTruthy();
    expect(screen.getByText('Completed on May 30, 2027')).toBeTruthy();

    const months = screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(months).toEqual(['July 2027', 'May 2027']);
  });

  /**
   * El historial es de ESTA cuenta. `listScheduled` devuelve toda la planta —un miembro del
   * JHSC viendo la programación de su sitio es legítimo—, así que el recorte es acá.
   */
  it('no lista lo que completó otro inspector', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'mine', period_start: '2027-07-01' }),
      scheduled({ id: 'theirs', period_start: '2027-06-01', inspector_id: OTHER }),
    ]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.queryByText('June 2027')).toBeNull();
  });

  it('un mes que todavía se debe no figura como completado', async () => {
    listScheduled.mockResolvedValue([
      scheduled({ id: 'open', period_start: '2027-08-01', status: 'open', inspection_id: null, completed_at: null }),
    ]);

    renderRoute();

    expect(await screen.findByText('You have not completed any inspections yet.')).toBeTruthy();
  });

  /**
   * Sin fecha visible se deja el hueco. Inventar el día del período fecharía el registro
   * con algo que nadie firmó.
   */
  it('deja el hueco cuando el período está cerrado y la fecha no viene', async () => {
    listScheduled.mockResolvedValue([scheduled({ completed_at: null })]);

    renderRoute();

    expect(await screen.findByText('July 2027')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('sin red lo dice, y no finge una lista vacía', async () => {
    listScheduled.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/Past inspections need a connection/)).toBeTruthy();
    expect(screen.queryByText('You have not completed any inspections yet.')).toBeNull();
  });

  /** El reporte todavía no existe: la acción se ve, pero no promete una pantalla. */
  it('ofrece el reporte deshabilitado, no un link roto', async () => {
    listScheduled.mockResolvedValue([scheduled()]);

    renderRoute();

    const report = await screen.findByRole('button', { name: /View report/ });
    expect(report.hasAttribute('disabled')).toBe(true);
  });
});
