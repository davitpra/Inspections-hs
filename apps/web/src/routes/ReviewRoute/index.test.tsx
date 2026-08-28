import type { TemplateDocument } from '@hs/forms';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewRoute } from './index';

const findDraft = vi.hoisted(() => vi.fn());
const loadDraft = vi.hoisted(() => vi.fn());
const documentForDraft = vi.hoisted(() => vi.fn());
const signDraft = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());
const runOutbox = vi.hoisted(() => vi.fn());
const isQueued = vi.hoisted(() => vi.fn());
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
vi.mock('../../offline/outbox', () => ({ enqueue, runOutbox, isQueued }));
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
    // `created_at` no es decorado: el encabezado lo fecha, y sin él la pantalla no se pinta.
    draft: { client_submission_id: 'draft-1', status, created_at: '2026-08-26T14:42:00.000Z' },
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

/**
 * A dónde va el inspector después de firmar.
 *
 * La cola es el destino solo cuando quedó algo en ella. Con red, el envío sale en el
 * acto y la entrada se borra al aceptarse: mandarlo igual al outbox le mostraba una
 * lista vacía —"nothing is waiting"— justo cuando su única pregunta era qué pasó con la
 * inspección que acababa de firmar.
 */
describe('destino después de firmar', () => {
  beforeEach(() => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue({ sections: [] });
    storedTemplateVersion.mockResolvedValue({ inspector_id: ACCOUNT });
    signDraft.mockResolvedValue(undefined);
    enqueue.mockResolvedValue(undefined);
    runOutbox.mockResolvedValue([]);
  });

  async function sign(): Promise<void> {
    renderRoute();

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Sign and submit' });
      expect(button.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign and submit' }));
  }

  /** La fila desapareció de la cola: `accept` es el único que la borra. */
  it('lleva a la lista con el acuse cuando el servidor ya la aceptó', async () => {
    isQueued.mockResolvedValue(false);

    await sign();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/', search: { submitted: 'accepted' } });
    });
  });

  it('lleva a la cola cuando la entrada quedó esperando', async () => {
    isQueued.mockResolvedValue(true);

    await sign();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/outbox' }));
  });

  /**
   * `signDraft` vuelve a comprobar los hallazgos y lanza si algo cambió. No se firmó
   * nada: sacar al inspector de esta pantalla le esconde el único lugar donde arreglarlo.
   */
  it('se queda en la pantalla cuando la firma falla', async () => {
    signDraft.mockRejectedValue(new Error('incomplete finding'));

    await sign();

    await waitFor(() => expect(signDraft).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * Y LO DICE. Quedarse callado en el punto de no retorno se lee como "no pasó nada",
   * que es lo contrario de lo que hay que entender: el botón se rehabilita solo, y sin
   * aviso el inspector no tiene forma de distinguir un error de un clic que no registró.
   */
  it('muestra que no se firmó cuando la firma falla', async () => {
    signDraft.mockRejectedValue(new Error('incomplete finding'));

    await sign();

    await waitFor(() => {
      expect(screen.getByText(/This inspection was not signed/)).toBeTruthy();
    });

    // El mensaje interno del error no llega a la pantalla.
    expect(screen.queryByText(/incomplete finding/)).toBeNull();
  });
});

/**
 * LO QUE LA PANTALLA DICE AL LLEGAR.
 *
 * La única pregunta con la que se abre esta pantalla es si se puede firmar, y la respuesta
 * tiene que estar escrita —no deducible del botón deshabilitado ni del color de un aviso.
 * El documento viaja completo a propósito: `validateAnswers` es la regla real, la misma que
 * corre el servidor (ADR-007), y lo que se verifica es que su resultado llegue a la pantalla
 * como una parada con nombre.
 */
describe('el veredicto', () => {
  const DOCUMENT: TemplateDocument = {
    sections: [
      {
        section_key: 'emergency',
        section_title: 'Emergency preparedness',
        position: 1,
        items: [
          {
            item_key: 'emergency.exits-unobstructed',
            prompt: 'Are emergency exits unobstructed?',
            position: 1,
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT } });
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    storedTemplateVersion.mockResolvedValue({
      inspector_id: ACCOUNT,
      template_name: 'Monthly workplace inspection',
    });
  });

  it('nombra la parada que falta y no deja firmar', async () => {
    loadDraft.mockResolvedValue(loadedDraft());
    documentForDraft.mockResolvedValue(DOCUMENT);

    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('1 item still needs your attention')).toBeTruthy();
    });

    // La pregunta como se leyó en el recorrido, y la instrucción — nunca la `item_key`.
    expect(screen.getByText('Are emergency exits unobstructed?')).toBeTruthy();
    expect(screen.getByText('Answer this question.')).toBeTruthy();
    expect(screen.queryByText(/emergency\.exits-unobstructed/)).toBeNull();

    expect(
      screen.getByRole('button', { name: 'Sign and submit' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('dice que se puede firmar cuando no queda nada, y contra qué inspección', async () => {
    loadDraft.mockResolvedValue({
      ...loadedDraft(),
      // `yes_no` es booleano en el motor; `fails_on: 'no'` hace de `false` la negativa.
      answers: { 'emergency.exits-unobstructed': true },
    });
    documentForDraft.mockResolvedValue(DOCUMENT);

    renderRoute();

    await waitFor(() => expect(screen.getByText('Ready to sign')).toBeTruthy());

    // El encabezado nombra el formulario: en el punto de no retorno, contra qué se firma.
    expect(screen.getByText(/Monthly workplace inspection/)).toBeTruthy();
    expect(screen.getByText('1 of 1 answered')).toBeTruthy();
  });
});
