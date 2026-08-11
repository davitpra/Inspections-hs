import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecurrenceReport } from '@hs/contracts';

import { RecurrenceRoute } from './RecurrenceRoute';

const SITE = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';
const FINDING_A = '33333333-3333-4333-8333-333333333333';
const FINDING_B = '44444444-4444-4444-8444-444444444444';

const getRecurrence = vi.hoisted(() => vi.fn());

vi.mock('../api/recurrence', () => ({ getRecurrence }));

function report(overrides: Partial<RecurrenceReport> = {}): RecurrenceReport {
  return {
    window_months: 12,
    group_by: 'item_location',
    excluded_manual_count: 0,
    series: [
      {
        site_id: SITE,
        item_key: 'dock.guards',
        item_prompt: 'Are all machine guards fitted and secured?',
        location_id: LOCATION,
        location_count: 1,
        occurrence_count: 4,
        template_version_item_count: 3,
        first_occurred_at: '2026-01-10T13:00:00.000Z',
        last_occurred_at: '2026-08-10T13:00:00.000Z',
        finding_ids: [FINDING_B, FINDING_A],
      },
    ],
    ...overrides,
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <RecurrenceRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getRecurrence.mockReset();
});

// `globals: false` en la config de Vitest: el auto-cleanup de Testing Library no se
// engancha solo, así que el DOM del test anterior sobreviviría al siguiente y toda
// consulta encontraría dos elementos.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('la lista de series', () => {
  it('muestra la serie con su conteo y las versiones que cruzó', async () => {
    getRecurrence.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('Are all machine guards fitted and secured?')).toBeTruthy();
    expect(screen.getByText('4 times')).toBeTruthy();

    // El número que hace auditable el riesgo A: la serie cruzó tres versiones y lo dice.
    expect(screen.getByText('Template versions crossed')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('pide con los parámetros por defecto cuando el lector no elige ninguno', async () => {
    getRecurrence.mockResolvedValue(report());

    renderRoute();

    await waitFor(() =>
      expect(getRecurrence).toHaveBeenCalledWith({
        windowMonths: 12,
        groupBy: 'item_location',
      }),
    );
  });
});

describe('los dos controles', () => {
  it('cambiar la ventana vuelve a pedir con la ventana nueva', async () => {
    getRecurrence.mockResolvedValue(report());

    renderRoute();
    await screen.findByText('Are all machine guards fitted and secured?');

    fireEvent.change(screen.getByLabelText(/Window/), { target: { value: '24' } });

    await waitFor(() =>
      expect(getRecurrence).toHaveBeenCalledWith({
        windowMonths: 24,
        groupBy: 'item_location',
      }),
    );
  });

  it('cambiar la agrupación vuelve a pedir con el modo nuevo', async () => {
    getRecurrence.mockResolvedValue(report());

    renderRoute();
    await screen.findByText('Are all machine guards fitted and secured?');

    fireEvent.change(screen.getByLabelText(/Group by/), { target: { value: 'item' } });

    await waitFor(() =>
      expect(getRecurrence).toHaveBeenCalledWith({ windowMonths: 12, groupBy: 'item' }),
    );
  });
});

/**
 * §5 riesgo A — el fallo de esta feature no produce ningún error y se ve exactamente
 * igual que la ausencia de patrón. Estas dos aserciones son lo único que separa las dos
 * lecturas en pantalla.
 */
describe('la lista vacía dice por qué está vacía', () => {
  it('con hallazgos manuales excluidos, lo explica', async () => {
    getRecurrence.mockResolvedValue(
      report({ series: [], excluded_manual_count: 3 }),
    );

    renderRoute();

    expect(await screen.findByText(/Nothing repeated in the last 12 months/)).toBeTruthy();
    expect(screen.getByText(/3 findings were entered by hand/)).toBeTruthy();
  });

  it('sin excluidos, dice que todo lo del período sí se comparó', async () => {
    getRecurrence.mockResolvedValue(report({ series: [], excluded_manual_count: 0 }));

    renderRoute();

    expect(
      await screen.findByText(/all of them were checked against the history/),
    ).toBeTruthy();
  });
});

describe('sin conexión', () => {
  it('lo dice en vez de mostrar una lista vacía', async () => {
    getRecurrence.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('This view needs a connection.')).toBeTruthy();
  });
});
