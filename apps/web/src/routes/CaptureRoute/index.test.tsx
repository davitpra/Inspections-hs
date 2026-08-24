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
const getTemplateVersionPackage = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ getTemplateVersionPackage }));

vi.mock('../../offline/prefetch', () => ({
  missingForField,
  storedLocations,
  storedTemplateVersion,
  prefetchInspection,
}));

/**
 * `captureEligibility` viaja SIN doble: es la regla real que este test verifica, igual
 * que `InspectorHomeRoute` deja `isDiscardable` sin reemplazar. Lo que se dobla es la
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
  // `search` es mutable a propósito: la vista previa y la captura son la misma URL con
  // distinto search, así que un test la mueve para entrar por el otro camino.
  useSearch: () => search,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

let search: { preview?: '1' } = {};

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
  search = {};
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
      draft: { client_submission_id: 'draft-1', status: 'capturing', template_version_id: VERSION },
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
      draft: { client_submission_id: 'draft-1', status: 'capturing', template_version_id: VERSION },
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
      draft: { client_submission_id: 'draft-1', status: 'capturing', template_version_id: VERSION },
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

/**
 * Spec: "A draft bound to a version the device no longer holds is named".
 *
 * `documentForDraft` ya se negaba a interpretar un borrador con una versión que no es la
 * suya —y hace bien: un envío construido con el documento equivocado vuelve rechazado
 * DESPUÉS del recorrido— pero devolvía el mismo `null` que "todavía no cargó", y la
 * pantalla se quedaba en "Loading the inspection…" para siempre. Sin texto y sin salida.
 */
describe('un borrador atado a una versión que el dispositivo ya no tiene', () => {
  const OTHER_VERSION = '66666666-6666-4666-8666-666666666666';

  function mismatched(status: 'capturing' | 'signed') {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: OTHER_VERSION,
      inspector_id: ACCOUNT,
    });
    storedLocations.mockResolvedValue([]);
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    openDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue({
      draft: { client_submission_id: 'draft-1', status, template_version_id: VERSION },
      answers: {},
      photos: [],
      findings: [],
    });
    // Lo que de verdad devuelve la función real ante el desajuste.
    documentForDraft.mockResolvedValue(null);
  }

  it('lo nombra en vez de quedarse cargando', async () => {
    mismatched('capturing');

    renderRoute();

    expect(await screen.findByText('Started against a different version')).toBeTruthy();
    expect(screen.getByText(/Discard this draft/)).toBeTruthy();
    expect(screen.queryByText('Loading the inspection…')).toBeNull();
  });

  /**
   * Firmado no se puede descartar (`isDiscardable`) y el servidor lo va a rechazar. El
   * texto lo dice así: prometer un descarte que la base va a negar sería peor que la mala
   * noticia.
   */
  it('no promete descartar un borrador ya firmado', async () => {
    mismatched('signed');

    renderRoute();

    expect(await screen.findByText('Started against a different version')).toBeTruthy();
    expect(screen.queryByText(/Discard this draft/)).toBeNull();
    expect(screen.getByText(/the server will refuse it/)).toBeTruthy();
  });
});

/**
 * La vista previa: mirar una asignación NO es empezarla.
 *
 * La garantía no es un `readOnly` que viaja hacia adentro esquivando escrituras — es que
 * `Walkthrough` no se monta, y con él no se monta `openDraft`. Estos tests fijan
 * exactamente eso, porque es lo que ADR-001 protege: el borrador es de quien lo empieza, y
 * ojear un mes que ni siquiera abrió no puede empezar nada.
 */
describe('la vista previa de una asignación', () => {
  const DOCUMENT = {
    sections: [
      {
        section_key: 'housekeeping',
        section_title: 'Work areas and housekeeping',
        items: [
          {
            item_key: 'floors_clear',
            prompt: 'Are floors clear of obstructions?',
            response_type: 'yes_no',
            required: true,
          },
        ],
      },
    ],
  };

  it('muestra las preguntas y no abre ningún borrador', async () => {
    search = { preview: '1' };
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      document: DOCUMENT,
    });

    renderRoute();

    expect(await screen.findByText('Are floors clear of obstructions?')).toBeTruthy();
    expect(screen.getByText('Work areas and housekeeping')).toBeTruthy();

    expect(openDraft).not.toHaveBeenCalled();
    expect(loadDraft).not.toHaveBeenCalled();
    expect(prefetchInspection).not.toHaveBeenCalled();
  });

  /**
   * El caso que justifica la pantalla: el mes que viene no está descargado. Se pide el
   * documento por red y NO se guarda — si se guardara, ojear dejaría la inspección "lista
   * para el campo" y la pantalla de inicio reportaría una decisión que nadie tomó.
   */
  it('pide el documento por red cuando no está en el dispositivo, y no lo descarga', async () => {
    search = { preview: '1' };
    storedTemplateVersion.mockResolvedValue(null);
    getTemplateVersionPackage.mockResolvedValue({ document: DOCUMENT });

    renderRoute();

    expect(await screen.findByText('Are floors clear of obstructions?')).toBeTruthy();

    expect(getTemplateVersionPackage).toHaveBeenCalledWith(INSPECTION);
    expect(prefetchInspection).not.toHaveBeenCalled();
    expect(openDraft).not.toHaveBeenCalled();
  });

  it('sin documento y sin red lo dice, en vez de mostrar medio recorrido', async () => {
    search = { preview: '1' };
    storedTemplateVersion.mockResolvedValue(null);
    getTemplateVersionPackage.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText('Preview unavailable')).toBeTruthy();
    expect(openDraft).not.toHaveBeenCalled();
  });
});

/**
 * Spec offline-capture: "A negative answer shows the corrective action its question
 * prescribes".
 *
 * El borrador se carga CON la respuesta negativa ya puesta en vez de hacer clic en el
 * control, y es a propósito: hacer clic ejercitaría `saveAnswer` contra Dexie —que acá va
 * sin doble— y este change no toca esa escritura. Lo que se fija es lo que se ve cuando
 * el ítem ya es negativo, que es exactamente lo que el change agrega. Quién es negativo
 * lo sigue decidiendo `negativeAnswers` de `@hs/forms`, sin doble.
 */
describe('la acción correctiva prescrita', () => {
  const PRESCRIBED = 'Stop the machine and refit the guard before it runs again.';

  const DOCUMENT = {
    sections: [
      {
        section_key: 'machine_guarding',
        section_title: 'Machine guarding',
        items: [
          {
            item_key: 'guard_in_place',
            prompt: 'Is the guard in place?',
            position: 1,
            response_type: 'yes_no',
            required: true,
            finding: { corrective_action: PRESCRIBED },
          },
          {
            item_key: 'floors_clear',
            prompt: 'Are floors clear of obstructions?',
            position: 2,
            response_type: 'yes_no',
            required: true,
          },
        ],
      },
    ],
  };

  function openWithNegativeAnswers(): void {
    useAppSession.mockReturnValue({ account: { userId: ACCOUNT }, ready: true });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      site_id: SITE,
      template_version_id: VERSION,
      inspector_id: ACCOUNT,
    });
    storedLocations.mockResolvedValue([]);
    findDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    openDraft.mockResolvedValue({ client_submission_id: 'draft-1' });
    loadDraft.mockResolvedValue({
      draft: { client_submission_id: 'draft-1', status: 'capturing', template_version_id: VERSION },
      answers: { guard_in_place: false, floors_clear: false },
      photos: [],
      findings: [
        { client_submission_id: 'draft-1', item_key: 'guard_in_place', description: '' },
        { client_submission_id: 'draft-1', item_key: 'floors_clear', description: '' },
      ],
    });
    documentForDraft.mockResolvedValue(DOCUMENT);

    renderRoute();
  }

  it('muestra lo prescrito y deja la descripción del inspector vacía', async () => {
    openWithNegativeAnswers();

    expect(await screen.findByText(PRESCRIBED)).toBeTruthy();
    expect(screen.getAllByText('Corrective action')).toHaveLength(1);

    // Lo prescrito no es lo observado: el campo sigue esperando lo que el inspector vio.
    // Hay dos, uno por ítem negativo; el de la pregunta que prescribe es el primero.
    const descriptions = screen.getAllByLabelText('What is wrong?') as HTMLTextAreaElement[];
    expect(descriptions[0]!.value).toBe('');
    expect(descriptions[0]!.placeholder).toBe('');
  });

  it('no muestra nada para una pregunta que no prescribe', async () => {
    openWithNegativeAnswers();

    // Las dos respuestas son negativas y las dos piden su hallazgo…
    expect(await screen.findByText(PRESCRIBED)).toBeTruthy();
    expect(screen.getAllByText('This needs a finding')).toHaveLength(2);

    // …pero sólo una de las dos trae prescripción, y la otra no dibuja ni el encabezado.
    expect(screen.getAllByText('Corrective action')).toHaveLength(1);
  });
});
