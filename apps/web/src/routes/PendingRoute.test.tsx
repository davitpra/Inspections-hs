import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingRoute } from './PendingRoute';

const request = vi.hoisted(() => vi.fn());
const listDrafts = vi.hoisted(() => vi.fn());
const missingForField = vi.hoisted(() => vi.fn());
const prefetchInspection = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => ({ sessionClient: { request } }));
vi.mock('../offline/drafts', () => ({ listDrafts }));
vi.mock('../offline/prefetch', () => ({ missingForField, prefetchInspection }));
vi.mock('../app/session-context', () => ({ useAppSession }));
vi.mock('../app/InstallPrompt', () => ({ InstallPrompt: () => null }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  }) => (
    <a href={Object.entries(params ?? {}).reduce((path, [k, v]) => path.replace(`$${k}`, v), to)}>
      {children}
    </a>
  ),
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';

function pending() {
  return [
    {
      id: INSPECTION,
      site_id: SITE,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      template_name: 'Monthly general workplace inspection',
      template_version_id: VERSION,
      overdue: true,
    },
  ];
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <PendingRoute />
    </QueryClientProvider>,
  );
}

/**
 * La lista de pendientes ES el flujo: no hay pantalla intermedia entre ver que una
 * inspección falta descargar y descargarla. Lo que estos tests fijan es que la fila
 * ofrezca UNA acción y que sea la que corresponde al estado del paquete — ofrecer
 * "empezar" sin documento manda al inspector a una pantalla que lo va a rechazar.
 */
describe('PendingRoute', () => {
  beforeEach(() => {
    request.mockResolvedValue({ ok: true, value: pending() });
    listDrafts.mockResolvedValue([]);
    useAppSession.mockReturnValue({ account: { userId: USER } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('ofrece descargar, y no empezar, cuando falta el paquete', async () => {
    missingForField.mockResolvedValue(['template_version', 'locations', 'roster']);

    renderRoute();

    expect(
      await screen.findByText(
        'Not ready — missing the inspection form, the location list, the roster',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download for the field' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start inspection' })).toBeNull();
  });

  it('descarga y pasa a ofrecer el recorrido', async () => {
    missingForField.mockResolvedValueOnce(['roster']).mockResolvedValue([]);
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations', 'roster'],
      missing: [],
      errors: {},
    });

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Download for the field' }));

    await waitFor(() => expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION));

    const start = await screen.findByRole('link', { name: 'Start inspection' });
    expect(start.getAttribute('href')).toBe(`/inspections/${INSPECTION}/capture`);
    expect(screen.queryByRole('button', { name: 'Download for the field' })).toBeNull();
  });

  /**
   * Una descarga parcial guarda lo que sí llegó y NO se reporta como lista. Lo que
   * quedó afuera se nombra, porque reintentar es la acción y el inspector tiene que
   * saber que todavía le falta algo antes de salir.
   */
  it('nombra lo que quedó afuera de una descarga parcial', async () => {
    missingForField.mockResolvedValue(['roster']);
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations'],
      missing: ['roster'],
      errors: { roster: 'network' },
    });

    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Download for the field' }));

    expect(
      await screen.findByText(
        'Still missing the roster. Try again while you have a connection.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start inspection' })).toBeNull();
  });
});
