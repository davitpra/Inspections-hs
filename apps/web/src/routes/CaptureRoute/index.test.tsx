import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaptureRoute } from './index';

const missingForField = vi.hoisted(() => vi.fn());
const storedLocations = vi.hoisted(() => vi.fn());
const storedTemplateVersion = vi.hoisted(() => vi.fn());
const prefetchInspection = vi.hoisted(() => vi.fn());
const findDraft = vi.hoisted(() => vi.fn());
const openDraft = vi.hoisted(() => vi.fn());
const loadDraft = vi.hoisted(() => vi.fn());
const documentForDraft = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../offline/prefetch', () => ({
  missingForField,
  storedLocations,
  storedTemplateVersion,
  prefetchInspection,
}));

/**
 * `captureEligibility` viaja SIN doble: es la regla real que este test verifica, igual
 * que `PendingRoute` deja `isDiscardable` sin reemplazar. Lo que se dobla es la
 * lectura/escritura de Dexie, no la decisión.
 */
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  findDraft,
  openDraft,
  loadDraft,
  documentForDraft,
}));

vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: INSPECTION }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const OTHER_ACCOUNT = '55555555-5555-4555-8555-555555555555';

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <CaptureRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Spec offline-capture: "Capture does not start for an inspection the account is not
 * assigned" y su hermana "An unassigned inspection does not open for capture". Las dos
 * se resuelven con lo que YA está descargado — sin abrir un borrador, y por lo tanto sin
 * pedir nada más.
 */
describe('elegibilidad de captura', () => {
  it('no abre un borrador de una inspección asignada a otra cuenta', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      inspector_id: OTHER_ACCOUNT,
    });
    findDraft.mockResolvedValue(undefined);

    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('Not your inspection')).toBeTruthy();
    });

    expect(screen.getByText('This inspection is assigned to someone else.')).toBeTruthy();
    expect(openDraft).not.toHaveBeenCalled();
  });

  it('no abre un borrador de una inspección sin inspector asignado', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      inspector_id: null,
    });
    findDraft.mockResolvedValue(undefined);

    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('This inspection has no inspector assigned.')).toBeTruthy();
    });

    expect(openDraft).not.toHaveBeenCalled();
  });

  it('abre el borrador cuando la cuenta es la asignada', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      inspector_id: ACCOUNT,
    });
    storedLocations.mockResolvedValue([]);
    findDraft.mockResolvedValue(undefined);
    openDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue({
      draft: { client_submission_id: 'draft-1', status: 'capturing' },
      answers: {},
      photos: [],
      findings: [],
    });
    documentForDraft.mockResolvedValue({ sections: [] });

    renderRoute();

    await waitFor(() => expect(openDraft).toHaveBeenCalled());
    expect(screen.queryByText('Not your inspection')).toBeNull();
  });

  /**
   * design D5 — un borrador que ya existe se sigue abriendo aunque la inspección haya
   * sido reasignada mientras tanto. Lo que se niega a partir de acá es firmar
   * (`ReviewRoute`), no seguir editando lo que ya se empezó.
   */
  it('sigue abriendo un borrador ya existente aunque la inspección se haya reasignado', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      inspector_id: OTHER_ACCOUNT,
    });
    storedLocations.mockResolvedValue([]);
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    openDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue({
      draft: { client_submission_id: 'draft-1', status: 'capturing' },
      answers: {},
      photos: [],
      findings: [],
    });
    documentForDraft.mockResolvedValue({ sections: [] });

    renderRoute();

    await waitFor(() => expect(openDraft).toHaveBeenCalled());
    expect(screen.queryByText('Not your inspection')).toBeNull();
  });

  /** design D4 — sin el campo guardado (descarga previa a este change), se permite. */
  it('abre el borrador cuando la descarga guardada no tiene inspector_id', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({ site_id: SITE, template_version_id: VERSION });
    storedLocations.mockResolvedValue([]);
    findDraft.mockResolvedValue(undefined);
    openDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue({
      draft: { client_submission_id: 'draft-1', status: 'capturing' },
      answers: {},
      photos: [],
      findings: [],
    });
    documentForDraft.mockResolvedValue({ sections: [] });

    renderRoute();

    await waitFor(() => expect(openDraft).toHaveBeenCalled());
    expect(screen.queryByText('Not your inspection')).toBeNull();
  });
});
