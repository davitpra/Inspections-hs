import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import { InspectorHomeRoute } from './index';

const request = vi.hoisted(() => vi.fn());
const listDrafts = vi.hoisted(() => vi.fn());
const discardDraft = vi.hoisted(() => vi.fn());
const missingForField = vi.hoisted(() => vi.fn());
const prefetchInspection = vi.hoisted(() => vi.fn());
const storedTemplateVersion = vi.hoisted(() => vi.fn());
const prefetchedAt = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const listScheduled = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => vi.fn(() => ({}) as { submitted?: 'accepted' }));

vi.mock('../../api/client', () => ({ sessionClient: { request } }));
vi.mock('../../api/inspections', () => ({ listSites, listScheduled }));
/**
 * Del almacén se reemplazan las dos escrituras y nada más: `isDiscardable` y
 * `DiscardRefusedError` son la regla real y el error real. Un doble de esos dos dejaría
 * a la fila decidiendo con una regla de mentira, que es justo lo que estos tests miran.
 */
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  listDrafts,
  discardDraft,
}));
/**
 * De la descarga previa se reemplazan las lecturas de Dexie y la escritura, nunca
 * `packageDrift`: esa es la decisión que estos tests miran, y un doble la volvería una
 * tautología.
 */
vi.mock('../../offline/prefetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/prefetch')>()),
  missingForField,
  prefetchInspection,
  storedTemplateVersion,
  prefetchedAt,
}));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('../../app/InstallPrompt', () => ({ InstallPrompt: () => null }));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search(),
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

function pending(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: INSPECTION,
      site_id: SITE,
      period_start: '2026-03-01',
      period_months: 1,
      period_end: '2026-03-31',
      template_name: 'Monthly general workplace inspection',
      template_version_id: VERSION,
      template_version: 2,
      latest_template_version: 2,
      latest_template_version_id: VERSION,
      overdue: true,
      ...overrides,
    },
  ];
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <InspectorHomeRoute />
    </QueryClientProvider>,
  );
}

/**
 * La lista de pendientes ES el flujo: no hay pantalla intermedia entre ver que una
 * inspección falta descargar y descargarla. Lo que estos tests fijan es que la asignación
 * destacada ofrezca UNA acción y que sea la que corresponde al estado del paquete —
 * ofrecer "empezar" sin documento manda al inspector a una pantalla que lo va a rechazar.
 *
 * `pending()` es una sola inspección VENCIDA: `focusedAssignment` la elige como héroe de
 * la pantalla en cualquiera de estos tests, así que las mismas aserciones de antes —el
 * botón, el link, el texto de lo que falta— ahora las produce `AssignmentHero` /
 * `AssignmentChecklist` y no la grilla del año.
 */
describe('InspectorHomeRoute', () => {
  beforeEach(() => {
    request.mockResolvedValue({ ok: true, value: pending() });
    listDrafts.mockResolvedValue([]);
    discardDraft.mockResolvedValue(true);
    storedTemplateVersion.mockResolvedValue(null);
    prefetchedAt.mockResolvedValue(null);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listScheduled.mockResolvedValue([]);
    useAppSession.mockReturnValue({
      account: { userId: USER, siteScope: [SITE], firstName: 'Marie', lastName: 'Tremblay' },
    });
    search.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /**
   * El acuse de la firma. Sin él, quien acaba de firmar con red aterrizaba en una cola
   * vacía que decía "nothing is waiting" y no mencionaba su inspección por ningún lado.
   */
  it('confirma la inspección aceptada cuando se llega desde la firma', async () => {
    missingForField.mockResolvedValue([]);
    search.mockReturnValue({ submitted: 'accepted' });

    renderRoute();

    expect(await screen.findByText(/sent and accepted/)).toBeTruthy();
  });

  it('no confirma nada cuando se entra a la pantalla por su cuenta', async () => {
    missingForField.mockResolvedValue([]);

    renderRoute();

    await screen.findByText('My inspections');
    expect(screen.queryByText(/sent and accepted/)).toBeNull();
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

     await waitFor(() =>
       expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION, { advance: true }),
     );

    const start = await screen.findByRole('link', { name: 'Start inspection' });
    expect(start.getAttribute('href')).toBe(`/inspections/${INSPECTION}/capture`);

    // Lo que desaparece es la PRIMERA descarga; volver a bajar sigue ofrecido, porque el
    // roster y las ubicaciones envejecen solas y no hay otra pantalla donde arreglarlo.
    expect(screen.queryByRole('button', { name: 'Download for the field' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh field package' })).toBeTruthy();
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

  /**
   * La razón de ser del refresco: `locations` y `roster` son la foto ACTIVA de la planta
   * al momento de la descarga y envejecen solas. Hasta ahora el control desaparecía en
   * cuanto el paquete estaba completo y no había ninguna otra pantalla donde arreglarlo.
   */
  it('vuelve a bajar el paquete ya completo, y dice de cuándo es', async () => {
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      kind: 'template_version',
      site_id: SITE,
      template_version_id: VERSION,
      version: 2,
      document: { sections: [] },
      inspector_id: USER,
    });
    prefetchedAt.mockResolvedValue('2026-03-02T14:05:00.000Z');
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations', 'roster'],
      missing: [],
      errors: {},
    });

    renderRoute();

    expect(await screen.findByText(/^Downloaded /)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh field package' }));

     await waitFor(() =>
       expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION, { advance: true }),
     );
  });

  /**
   * La deriva se decide con lo que YA viaja: la versión congelada viene en la lista de
   * pendientes y la guardada está en el dispositivo. Sin este aviso, el desajuste se
   * descubría al enviar, después del recorrido.
   */
  it('nombra el paquete que no es la versión a la que la inspección está atada', async () => {
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      kind: 'template_version',
      site_id: SITE,
      template_version_id: '55555555-5555-4555-8555-555555555555',
      version: 1,
      document: { sections: [] },
      inspector_id: USER,
    });

    renderRoute();

    expect(await screen.findByText(/not the version this inspection is locked to/)).toBeTruthy();
  });

  it('un paquete alineado no avisa nada', async () => {
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue({
      kind: 'template_version',
      site_id: SITE,
      template_version_id: VERSION,
      version: 2,
      document: { sections: [] },
      inspector_id: USER,
    });

    renderRoute();

    await screen.findByRole('button', { name: 'Refresh field package' });
    expect(screen.queryByText(/not the version this inspection is locked to/)).toBeNull();
  });

  it('nombra la versión nueva y la toma al refrescar sin borrador', async () => {
    missingForField.mockResolvedValue([]);
    request.mockResolvedValue({
      ok: true,
      value: pending({
        latest_template_version: 3,
        latest_template_version_id: '77777777-7777-4777-8777-777777777777',
      }),
    });
    storedTemplateVersion.mockResolvedValue({
      kind: 'template_version',
      site_id: SITE,
      template_version_id: VERSION,
      version: 2,
      document: { sections: [] },
      inspector_id: USER,
    });
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations', 'roster'],
      missing: [],
      errors: {},
    });

    renderRoute();

    expect(await screen.findByText('Version 3 is published')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh field package' }));

    await waitFor(() =>
      expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION, { advance: true }),
    );
  });

  it('con borrador nombra el descarte y refresca sin avanzar', async () => {
    missingForField.mockResolvedValue([]);
    request.mockResolvedValue({
      ok: true,
      value: pending({
        latest_template_version: 3,
        latest_template_version_id: '77777777-7777-4777-8777-777777777777',
      }),
    });
    storedTemplateVersion.mockResolvedValue({
      kind: 'template_version',
      site_id: SITE,
      template_version_id: VERSION,
      version: 2,
      document: { sections: [] },
      inspector_id: USER,
    });
    listDrafts.mockResolvedValue([
      {
        client_submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scheduled_inspection_id: INSPECTION,
        account_id: USER,
        site_id: SITE,
        template_version_id: VERSION,
        created_at: '2026-03-01T10:00:00.000Z',
        updated_at: '2026-03-01T10:00:00.000Z',
        current_item_key: null,
        status: 'capturing',
        signed_at: null,
      },
    ]);
    prefetchInspection.mockResolvedValue({
      scheduled_inspection_id: INSPECTION,
      stored: ['template_version', 'locations', 'roster'],
      missing: [],
      errors: {},
    });

    renderRoute();

    expect(await screen.findByText(/Discard this draft before refreshing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh field package' }));

    await waitFor(() => expect(prefetchInspection).toHaveBeenCalledWith(INSPECTION));
  });
});

/**
 * Cuál asignación es el héroe de la pantalla, y qué pasa cuando no hay ninguna.
 */
describe('InspectorHomeRoute — la asignación destacada', () => {
  const CURRENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    listDrafts.mockResolvedValue([]);
    discardDraft.mockResolvedValue(true);
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue(null);
    prefetchedAt.mockResolvedValue(null);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listScheduled.mockResolvedValue([]);
    useAppSession.mockReturnValue({
      account: { userId: USER, siteScope: [SITE], firstName: 'Marie', lastName: 'Tremblay' },
    });
    search.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** Lo vencido gana sobre cualquier otro mes, incluido el que está en curso. */
  it('destaca lo vencido más antiguo por sobre un mes al día', async () => {
    request.mockResolvedValue({
      ok: true,
      value: [
        {
          id: CURRENT,
          site_id: SITE,
          period_start: '2099-01-01',
          period_months: 1,
          period_end: '2099-01-31',
          template_name: 'Un mes al día',
          template_version_id: VERSION,
          template_version: 2,
          latest_template_version: 2,
          latest_template_version_id: VERSION,
          overdue: false,
        },
        ...pending(),
      ],
    });

    renderRoute();

    expect(await screen.findByText('Monthly general workplace inspection')).toBeTruthy();
    expect(screen.queryByText('Un mes al día')).toBeNull();
  });

  /** Sin nada pendiente, la pantalla dice explícitamente que no hay nada que hacer. */
  it('sin asignación, dice que no hay nada que hacer y no rompe', async () => {
    request.mockResolvedValue({ ok: true, value: [] });

    renderRoute();

    expect(await screen.findByText('No inspection assigned this month')).toBeTruthy();
  });
});

/**
 * Descartar es lo único de esta aplicación que destruye trabajo sin que quede copia en
 * ningún lado: el borrador nunca salió del dispositivo. Lo que estos tests fijan es que
 * un solo clic no alcance, que la confirmación diga qué se pierde, y que la línea de
 * ADR-001 —firmado ya no se descarta— se vea en la fila y no solo en la base.
 */
describe('InspectorHomeRoute — descartar un borrador', () => {
  const CAPTURING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const SIGNED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function draft(overrides: Record<string, unknown> = {}) {
    return {
      client_submission_id: CAPTURING,
      scheduled_inspection_id: INSPECTION,
      account_id: USER,
      site_id: SITE,
      template_version_id: VERSION,
      created_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-08-01T10:00:00.000Z',
      current_item_key: null,
      status: 'capturing',
      signed_at: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    request.mockResolvedValue({ ok: true, value: pending() });
    missingForField.mockResolvedValue([]);
    discardDraft.mockResolvedValue(true);
    storedTemplateVersion.mockResolvedValue(null);
    prefetchedAt.mockResolvedValue(null);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listScheduled.mockResolvedValue([]);
    useAppSession.mockReturnValue({
      account: { userId: USER, siteScope: [SITE], firstName: 'Marie', lastName: 'Tremblay' },
    });
    search.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** Abre el diálogo desde la fila y devuelve su botón de confirmar. */
  async function openDialog(): Promise<HTMLElement> {
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard the draft started 2026-08-01' }),
    );

    return screen.getByRole('button', { name: 'Discard the draft' });
  }

  it('no borra al pulsar la fila: pide confirmar y dice qué se pierde', async () => {
    listDrafts.mockResolvedValue([draft()]);

    const confirm = await openDialog();

    expect(discardDraft).not.toHaveBeenCalled();
    expect(
      screen.getByText(/answers, findings and photos of the inspection started on 2026-08-01/),
    ).toBeTruthy();
    expect(screen.getByText(/no copy to bring back/)).toBeTruthy();

    fireEvent.click(confirm);

    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith(CAPTURING, USER));
  });

  it('mantener el borrador cierra sin borrar nada', async () => {
    listDrafts.mockResolvedValue([draft()]);

    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Keep the draft' }));

    expect(discardDraft).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Discard the draft' })).toBeNull(),
    );
  });

  /** ADR-001: el envío es el punto de no retorno, y la fila lo dice en vez de callarlo. */
  it('una inspección firmada no ofrece descartar', async () => {
    listDrafts.mockResolvedValue([draft({ client_submission_id: SIGNED, status: 'signed' })]);

    renderRoute();

    expect(await screen.findByText(/Signed, waiting to send/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Discard/ })).toBeNull();
  });

  it('si la base se niega, lo dice y el diálogo no se cierra', async () => {
    listDrafts.mockResolvedValue([draft()]);
    discardDraft.mockRejectedValue(new DiscardRefusedError('already_queued'));

    fireEvent.click(await openDialog());

    expect(await screen.findByText(/signed and waiting to be sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard the draft' })).toBeTruthy();
  });
});

/**
 * La lista del dispositivo. El encabezado "Drafts on this device" tiene que ser cierto:
 * lo aceptado ya está en el servidor y no es un borrador de nadie.
 */
describe('InspectorHomeRoute — lo enviado no se lista como borrador', () => {
  function draft(overrides: Record<string, unknown> = {}) {
    return {
      client_submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scheduled_inspection_id: INSPECTION,
      account_id: USER,
      site_id: SITE,
      template_version_id: VERSION,
      created_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-08-01T10:00:00.000Z',
      current_item_key: null,
      status: 'capturing',
      signed_at: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    request.mockResolvedValue({ ok: true, value: pending() });
    missingForField.mockResolvedValue([]);
    storedTemplateVersion.mockResolvedValue(null);
    prefetchedAt.mockResolvedValue(null);
    listSites.mockResolvedValue([{ id: SITE, code: 'GLE', name: 'Glencoe', deactivated_at: null }]);
    listScheduled.mockResolvedValue([]);
    useAppSession.mockReturnValue({
      account: { userId: USER, siteScope: [SITE], firstName: 'Marie', lastName: 'Tremblay' },
    });
    search.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lo aceptado no se lista en el dispositivo ni se ofrece descartar', async () => {
    listDrafts.mockResolvedValue([
      draft({ status: 'accepted', client_submission_id: 'accepted-1' }),
    ]);

    renderRoute();

    expect(
      await screen.findByText('No drafts in progress on this device.'),
    ).toBeTruthy();
    expect(screen.queryByText('Submitted')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Discard/ })).toBeNull();
  });

  it('lo que sí pide trabajo sigue listado', async () => {
    listDrafts.mockResolvedValue([draft()]);

    renderRoute();

    // La tarjeta parte lo que antes era una sola cadena: el estado va en la píldora y la
    // fecha en el subtítulo, debajo del mes.
    await screen.findByText('Draft');
    expect(screen.getByText('Started 2026-08-01')).toBeTruthy();
    expect(screen.queryByText('No drafts in progress on this device.')).toBeNull();
  });
});
