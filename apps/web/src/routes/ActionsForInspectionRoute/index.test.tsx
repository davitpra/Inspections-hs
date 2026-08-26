import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionSummary } from '@hs/contracts';

import { ActionsForInspectionRoute } from './index';

const listActions = vi.hoisted(() => vi.fn());

vi.mock('../../api/actions', () => ({ listActions }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ inspectionId: '88888888-8888-4888-8888-888888888888' }),
  Link: ({
    to,
    params,
    className,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={substitute(to, params)} className={className}>
      {children}
    </a>
  ),
}));

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_A = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_B = '44444444-4444-4444-8444-444444444444';

function substitute(to: string, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce(
    (path, [name, value]) => path.replace(`$${name}`, value),
    to,
  );
}

function action(overrides: Partial<ActionSummary> = {}): ActionSummary {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    site_id: SITE_A,
    site_name: 'St. Thomas',
    assignee_person_id: '66666666-6666-4666-8666-666666666666',
    assignee_name: 'Dana Okafor',
    description: 'Install a fixed guard on line 3',
    severity: 'major',
    due_at: '2026-08-28T16:00:00.000Z',
    state: 'open',
    overdue: true,
    escalations: [],
    source: {
      kind: 'inspection',
      finding_id: '77777777-7777-4777-8777-777777777777',
      inspection_id: '88888888-8888-4888-8888-888888888888',
      scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
      template_id: TEMPLATE_A,
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ActionsForInspectionRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActionsForInspectionRoute', () => {
  it('nombra la carga sin mostrar una lista vacía', () => {
    listActions.mockReturnValue(new Promise(() => undefined));

    renderRoute();

    expect(screen.getByText('Loading corrective actions…')).toBeTruthy();
    expect(screen.queryByText(/No corrective actions/)).toBeNull();
  });

  it('explica que el listado necesita conexión', async () => {
    listActions.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('Corrective actions need a connection.')).toBeTruthy();
  });

  it('distingue una planta sin acciones de un filtro vacío', async () => {
    listActions.mockResolvedValue([]);

    renderRoute();

    expect(
      await screen.findByText('No corrective actions have been recorded for this inspection.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('muestra contexto operativo y navega al detalle', async () => {
    listActions.mockResolvedValue([action()]);

    renderRoute();

    expect(await screen.findAllByText('Monthly walkthrough')).toHaveLength(3);
    expect(screen.getByText('St. Thomas')).toBeTruthy();
    expect(screen.getByText('Dana Okafor')).toBeTruthy();
    expect(screen.getByText('Due 2026-08-28').className).toContain('badge--overdue');
    expect(screen.getByRole('link', { name: 'View action' }).getAttribute('href')).toBe(
      '/actions/55555555-5555-4555-8555-555555555555',
    );
  });

  it('oculta cerradas por defecto y permite mostrarlas', async () => {
    listActions.mockResolvedValue([
      action(),
      action({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        description: 'Closed corrective action',
        state: 'closed',
        overdue: false,
      }),
    ]);

    renderRoute();

    await screen.findByText('Install a fixed guard on line 3');
    expect(screen.queryByText('Closed corrective action')).toBeNull();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    expect(screen.getByText('Closed corrective action')).toBeTruthy();
    expect(screen.queryByText('Install a fixed guard on line 3')).toBeNull();
  });

  it('filtra por template y sitio y nombra una combinación sin resultados', async () => {
    listActions.mockResolvedValue([
      action(),
      action({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        site_id: SITE_B,
        site_name: 'Glencoe',
        source: {
          kind: 'inspection',
          finding_id: '77777777-7777-4777-8777-777777777777',
          inspection_id: '88888888-8888-4888-8888-888888888888',
          scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
          template_id: TEMPLATE_B,
          template_name: 'Quarterly equipment review',
        },
      }),
    ]);

    renderRoute();
    await screen.findAllByText('Monthly walkthrough');

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: `template:${TEMPLATE_A}` },
    });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: SITE_B } });

    expect(screen.getByText('No corrective actions match these filters.')).toBeTruthy();
  });
});
