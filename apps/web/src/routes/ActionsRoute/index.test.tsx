import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionSummary } from '@hs/contracts';

import { ActionsRoute } from './index';

const listActions = vi.hoisted(() => vi.fn());

vi.mock('../../api/actions', () => ({ listActions }));
vi.mock('@tanstack/react-router', () => ({
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
      template_id: '33333333-3333-4333-8333-333333333333',
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ActionsRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActionsRoute', () => {
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

  it('distingue una planta sin acciones de una lista vacía por error', async () => {
    listActions.mockResolvedValue([]);

    renderRoute();

    expect(
      await screen.findByText('No corrective actions have been recorded for your sites.'),
    ).toBeTruthy();
  });

  it('agrupa por inspección y enlaza a la vista de esa inspección', async () => {
    const manual = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: { kind: 'manual_finding', finding_id: '77777777-7777-4777-8777-777777777777' },
    });
    listActions.mockResolvedValue([action(), manual]);

    renderRoute();

    expect(await screen.findByText('Monthly walkthrough')).toBeTruthy();
    expect(screen.getByText('Other sources')).toBeTruthy();
    expect(screen.getByText('St. Thomas')).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'View corrective actions' })[0]!.getAttribute('href'),
    ).toBe('/actions/inspection/88888888-8888-4888-8888-888888888888');
  });
});
