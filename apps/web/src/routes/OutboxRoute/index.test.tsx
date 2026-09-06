import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutboxRoute } from './index';

const deviceWork = vi.hoisted(() => vi.fn());
const runOutbox = vi.hoisted(() => vi.fn());
const discardDraft = vi.hoisted(() => vi.fn());
const unsyncedStatus = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const useOnline = vi.hoisted(() => vi.fn());

vi.mock('../../offline/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/outbox')>()),
  deviceWork,
  runOutbox,
}));
vi.mock('../../offline/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/drafts')>()),
  discardDraft,
}));
vi.mock('../../offline/unsynced', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../offline/unsynced')>()),
  unsyncedStatus,
}));
vi.mock('../../offline/online', () => ({ useOnline }));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
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
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const SUBMISSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function draft(status: 'capturing' | 'signed', id = SUBMISSION) {
  return {
    client_submission_id: id,
    scheduled_inspection_id: INSPECTION,
    account_id: USER,
    site_id: '33333333-3333-4333-8333-333333333333',
    template_version_id: '55555555-5555-4555-8555-555555555555',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    status,
    signed_at: status === 'signed' ? '2026-08-02T10:00:00.000Z' : null,
  };
}

function queued(state: 'queued' | 'rejected', lastError: string | null = null) {
  const id = `${state}-submission`;

  return {
    draft: draft('signed', id),
    row: {
      client_submission_id: id,
      state,
      attempts: state === 'rejected' ? 1 : 0,
      next_attempt_at: 0,
      last_error: lastError,
      sending_since: null,
      lock_owner: null,
    },
  };
}

/** Un borrador sin firmar: no hay fila de cola porque firmar es lo que la crea. */
function unsigned() {
  return { draft: draft('capturing'), row: null };
}

/**
 * Las consultas se hacen DENTRO de la lista y no en la pantalla entera: la tira de números
 * del encabezado usa las mismas etiquetas que las píldoras de las filas —"Rejected by the
 * server", "Not signed yet"— y ahí es donde tienen que estar iguales. Buscar en el
 * documento entero encontraría las dos y no distinguiría el resumen del trabajo.
 */
async function list(): Promise<ReturnType<typeof within>> {
  return within(await screen.findByRole('list'));
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OutboxRoute />
    </QueryClientProvider>,
  );
}

describe('OutboxRoute', () => {
  beforeEach(() => {
    deviceWork.mockResolvedValue([]);
    runOutbox.mockResolvedValue([]);
    discardDraft.mockResolvedValue(true);
    unsyncedStatus.mockResolvedValue({
      answers: 0,
      drafts: 0,
      oldestDraftAgeDays: null,
      warn: false,
    });
    useOnline.mockReturnValue(true);
    useAppSession.mockReturnValue({ account: { userId: USER, siteScope: [] } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('tranquiliza cuando no queda nada en el dispositivo', async () => {
    renderRoute();

    expect(await screen.findByText('Nothing is waiting')).toBeTruthy();
  });

  it('muestra el motivo con el que el servidor rechazó un envío', async () => {
    deviceWork.mockResolvedValue([queued('rejected', 'finding_missing: guarding.gap')]);
    renderRoute();

    const rows = await list();

    expect(rows.getByText('Rejected by the server')).toBeTruthy();
    expect(rows.getByText('finding_missing: guarding.gap')).toBeTruthy();
  });

  /**
   * EL CASO QUE ESTA PANTALLA EXISTE PARA CUBRIR. Un borrador sin firmar no tiene fila de
   * cola y su inspección puede haber dejado de volver del servidor —cancelada, reasignada,
   * o una base que se rehízo—, con lo cual la página de la asignación no lo dibuja. El
   * indicador de ADR-010 lo cuenta igual y no se puede cerrar: sin esta lista, el aviso se
   * queda encendido sobre trabajo que nadie puede abrir ni descartar.
   */
  it('lista el borrador sin firmar que ninguna otra pantalla alcanza', async () => {
    deviceWork.mockResolvedValue([unsigned()]);
    renderRoute();

    const rows = await list();

    expect(rows.getByText('Not signed yet')).toBeTruthy();
    expect(rows.getByRole('link', { name: 'Open the inspection' }).getAttribute('href')).toBe(
      `/inspections/${INSPECTION}`,
    );
  });

  /** Sin fila de cola no hubo intentos: decir "Not tried yet" ahí sugiere que algo falló. */
  it('no habla de intentos en un borrador que no llegó a la cola', async () => {
    deviceWork.mockResolvedValue([unsigned()]);
    renderRoute();

    const rows = await list();

    expect(rows.queryByText('Not tried yet')).toBeNull();
  });

  it('descarta el borrador sin firmar desde su propia fila', async () => {
    deviceWork.mockResolvedValue([unsigned()]);
    renderRoute();

    const rows = await list();
    fireEvent.click(rows.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard the draft' }));

    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith(SUBMISSION, USER));
  });

  /**
   * ADR-001 — el envío es el punto de no retorno. Lo firmado ya no es del inspector, es
   * trabajo que el servidor tiene que recibir, y por eso no se ofrece descartarlo ni
   * siquiera cuando el servidor lo rechazó: hay que arreglarlo, no tirarlo.
   */
  it('no ofrece descartar lo que ya se firmó', async () => {
    deviceWork.mockResolvedValue([queued('queued'), queued('rejected', 'validation_failed')]);
    renderRoute();

    const rows = await list();

    expect(rows.getByText('Rejected by the server')).toBeTruthy();
    expect(rows.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  it('reintenta la cola entera desde el pie de la tarjeta', async () => {
    deviceWork.mockResolvedValue([queued('queued')]);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again now' }));

    await waitFor(() => expect(runOutbox).toHaveBeenCalledWith({ accountId: USER }));
  });
});
