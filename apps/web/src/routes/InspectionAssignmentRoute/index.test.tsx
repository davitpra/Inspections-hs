import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionAssignmentRoute } from './index';

const listPendingInspections = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const listDrafts = vi.hoisted(() => vi.fn());
const loadDraft = vi.hoisted(() => vi.fn());
const discardDraft = vi.hoisted(() => vi.fn());
const missingForField = vi.hoisted(() => vi.fn());
const storedTemplateVersion = vi.hoisted(() => vi.fn());
const prefetchedAt = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listPendingInspections, listSites }));
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  listDrafts,
  loadDraft,
  discardDraft,
}));
vi.mock('../../offline/prefetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/prefetch')>()),
  missingForField,
  storedTemplateVersion,
  prefetchedAt,
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => params(),
  useNavigate: () => navigate,
  Link: ({
    to,
    params: linkParams,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={Object.entries(linkParams ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}));

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const VERSION = '55555555-5555-4555-8555-555555555555';

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: FIRST,
    site_id: SITE,
    period_start: '2026-08-01',
    period_months: 1 as const,
    period_end: '2026-08-31',
    template_name: 'First requirement',
    template_version_id: VERSION,
    template_version: 2,
    latest_template_version: 2,
    latest_template_version_id: VERSION,
    overdue: true,
    ...overrides,
  };
}

function draft(status: 'capturing' | 'signed' | 'accepted') {
  return {
    client_submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scheduled_inspection_id: SECOND,
    account_id: USER,
    site_id: SITE,
    template_version_id: VERSION,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    status,
    signed_at: status === 'signed' ? '2026-08-02T10:00:00.000Z' : null,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InspectionAssignmentRoute />
    </QueryClientProvider>,
  );
}

describe('InspectionAssignmentRoute', () => {
  beforeEach(() => {
    params.mockReturnValue({ id: SECOND });
    listPendingInspections.mockResolvedValue([
      pending(),
      pending({ id: SECOND, template_name: 'Second requirement', overdue: false }),
    ]);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listDrafts.mockResolvedValue([]);
    loadDraft.mockResolvedValue(null);
    discardDraft.mockResolvedValue(true);
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue(null);
    prefetchedAt.mockResolvedValue(null);
    useAppSession.mockReturnValue({
      account: {
        userId: USER,
        siteScope: [SITE],
        firstName: 'Marie',
        lastName: 'Tremblay',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('abre exactamente la inspección seleccionada y desde ahí ofrece empezar', async () => {
    renderRoute();

    expect(await screen.findByText('Second requirement')).toBeTruthy();
    expect(screen.queryByText('First requirement')).toBeNull();
    expect((await screen.findByRole('link', { name: 'Start inspection' })).getAttribute('href')).toBe(
      `/inspections/${SECOND}/capture`,
    );
    expect(screen.getByRole('link', { name: 'Back to my inspections' }).getAttribute('href')).toBe('/');
  });

  it('ofrece retomar el borrador de la inspección seleccionada', async () => {
    listDrafts.mockResolvedValue([draft('capturing')]);
    renderRoute();

    expect((await screen.findByRole('link', { name: 'Resume inspection' })).getAttribute('href')).toBe(
      `/inspections/${SECOND}/capture`,
    );
  });

  it('ofrece abrir un borrador firmado', async () => {
    listDrafts.mockResolvedValue([draft('signed')]);
    renderRoute();

    expect((await screen.findByRole('link', { name: 'Open inspection' })).getAttribute('href')).toBe(
      `/inspections/${SECOND}/capture`,
    );
  });

  it('un id ausente no sustituye otra asignación ni ofrece captura', async () => {
    params.mockReturnValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    renderRoute();

    expect(await screen.findByText(/not available in your pending assignments/)).toBeTruthy();
    expect(screen.queryByText('First requirement')).toBeNull();
    expect(screen.queryByRole('link', { name: /inspection$/i })).toBeNull();
  });

  it('muestra el error de conexión sin ofrecer captura', async () => {
    listPendingInspections.mockRejectedValue(new Error('offline'));
    renderRoute();

    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a connection/);
    expect(screen.queryByRole('link', { name: /Start inspection/ })).toBeNull();
  });

  it('lista el borrador de ESTA asignación y ofrece su confirmación de descarte', async () => {
    listDrafts.mockResolvedValue([draft('capturing')]);
    renderRoute();

    const table = await screen.findByRole('table', { name: 'Draft on this device' });
    expect(within(table).getByText('Second requirement')).toBeTruthy();
    expect(within(table).getByText('Glencoe')).toBeTruthy();
    expect(within(table).getByText('Draft')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for the draft started 2026-08-01' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard draft' }));
    expect(screen.getByRole('button', { name: 'Discard the draft' })).toBeTruthy();
    expect(screen.getByText(/no copy to bring back/)).toBeTruthy();
  });

  it('un borrador firmado se abre pero ya no se descarta', async () => {
    listDrafts.mockResolvedValue([draft('signed')]);
    renderRoute();

    await screen.findByRole('table', { name: 'Draft on this device' });
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for the draft started 2026-08-01' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Discard draft' })).toBeNull();
  });

  it('sin trabajo local lo dice, y lo aceptado ya no es un borrador', async () => {
    renderRoute();
    expect(await screen.findByText('No draft in progress on this device.')).toBeTruthy();

    cleanup();
    listDrafts.mockResolvedValue([draft('accepted')]);
    renderRoute();
    expect(await screen.findByText('No draft in progress on this device.')).toBeTruthy();
  });

  it('mantiene la carga sin elegir una asignación por su cuenta', async () => {
    listPendingInspections.mockReturnValue(new Promise(() => undefined));
    renderRoute();

    expect(await screen.findByText('Loading inspection…')).toBeTruthy();
    expect(screen.queryByText('First requirement')).toBeNull();
    expect(screen.queryByRole('link', { name: /Start inspection/ })).toBeNull();
  });
});
