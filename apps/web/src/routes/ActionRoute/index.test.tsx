import type { Action, Session } from '@hs/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActionRoute } from './index';

const getAction = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/actions', () => ({
  getAction,
  transitionAction: vi.fn(),
  uploadEvidence: vi.fn(),
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: ACTION_ID }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/actions">{children}</a>,
}));

const ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function action(): Action {
  return {
    id: ACTION_ID,
    site_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    finding_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    investigation_id: null,
    assignee_person_id: PERSON_ID,
    description: 'Replace the damaged machine guard',
    due_at: '2027-08-30T16:00:00.000Z',
    remediation_group_id: null,
    created_by: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    created_at: '2027-08-01T12:00:00.000Z',
    state: 'open',
    overdue: false,
    events: [
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        position: 0,
        from_state: null,
        to_state: 'open',
        actor_user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        note: 'Approved after inspection.',
        reason: null,
        occurred_at: '2027-08-01T12:00:00.000Z',
        recorded_at: '2027-08-01T12:00:01.000Z',
        evidence: [],
      },
    ],
    escalations: [],
  };
}

describe('ActionRoute', () => {
  it('mantiene el permalink con la historia y el próximo paso compartidos', async () => {
    const account: Session = {
      userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      personId: PERSON_ID,
      role: 'external_auditor',
      siteScope: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      recordsFrom: null,
      recordsTo: null,
    };
    getAction.mockResolvedValue(action());
    useAppSession.mockReturnValue({ account });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActionRoute />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Replace the damaged machine guard' })).toBeTruthy();
    expect(screen.getByText('Approved after inspection.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeTruthy();
  });
});
