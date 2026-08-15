import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewRoute } from './index';

const findDraft = vi.hoisted(() => vi.fn());
const loadDraft = vi.hoisted(() => vi.fn());
const documentForDraft = vi.hoisted(() => vi.fn());
const signDraft = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());
const runOutbox = vi.hoisted(() => vi.fn());
const storedTemplateVersion = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

/**
 * `captureEligibility` e `incompleteFindings` viajan SIN doble: son la regla real que
 * este test verifica. Lo que se dobla es la lectura/escritura de Dexie.
 */
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  findDraft,
  loadDraft,
  documentForDraft,
  signDraft,
}));
vi.mock('../../offline/outbox', () => ({ enqueue, runOutbox }));
vi.mock('../../offline/prefetch', () => ({ storedTemplateVersion }));
vi.mock('../../app/session-context', () => ({ useAppSession }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: INSPECTION }),
  useNavigate: () => navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const OTHER_ACCOUNT = '55555555-5555-4555-8555-555555555555';

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReviewRoute />
    </QueryClientProvider>,
  );
}

function loadedDraft(status: 'capturing' | 'signed' = 'capturing') {
  return {
    draft: { client_submission_id: 'draft-1', status },
    answers: {},
    photos: [],
    findings: [],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Spec offline-capture: "A draft whose inspection is no longer the account's cannot be
 * signed". La comparación es contra el `inspector_id` guardado localmente
 * (`storedTemplateVersion`), nunca una lectura fresca (design D5).
 */
describe('elegibilidad para firmar', () => {
  it('deshabilita firmar cuando la inspección quedó asignada a otra cuenta', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue({ sections: [] });
    storedTemplateVersion.mockResolvedValue({ inspector_id: OTHER_ACCOUNT });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByText(/now assigned to someone else/)).toBeTruthy();
    });

    const button = screen.getByRole('button', { name: 'Sign and submit' });
    expect(button.hasAttribute('disabled')).toBe(true);

    // El borrador sigue legible: las respuestas no desaparecen porque no se pueda firmar.
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('deshabilita firmar cuando la inspección se quedó sin inspector', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue({ sections: [] });
    storedTemplateVersion.mockResolvedValue({ inspector_id: null });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByText(/no longer has an inspector assigned/)).toBeTruthy();
    });

    const button = screen.getByRole('button', { name: 'Sign and submit' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('deja firmar cuando la cuenta sigue siendo la asignada', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue({ sections: [] });
    storedTemplateVersion.mockResolvedValue({ inspector_id: ACCOUNT });

    renderRoute();

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Sign and submit' });
      expect(button.hasAttribute('disabled')).toBe(false);
    });

    expect(
      screen.queryByText(/now assigned to someone else|no longer has an inspector/),
    ).toBeNull();
  });

  /** design D4 — sin descarga guardada, no bloquea. */
  it('deja firmar cuando no hay paquete de campo guardado localmente', async () => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue({ sections: [] });
    storedTemplateVersion.mockResolvedValue(null);

    renderRoute();

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Sign and submit' });
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });
});
