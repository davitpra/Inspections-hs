import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComplianceReportSummary, ComplianceView, Session } from '@hs/contracts';

import { ComplianceRoute } from './index';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';
const HASH = 'a1b2c3d4'.repeat(8);

const getCoverage = vi.hoisted(() => vi.fn());
const listReports = vi.hoisted(() => vi.fn());
const generateReport = vi.hoisted(() => vi.fn());
const getDownloadUrl = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());

vi.mock('../../api/compliance', () => ({
  getCoverage,
  listReports,
  generateReport,
  getDownloadUrl,
}));

vi.mock('../../app/session-context', () => ({ useAppSession }));

function session(role: Session['role']): { account: Session } {
  return {
    account: {
      userId: USER,
      personId: PERSON,
      role,
      siteScope: [SITE],
      recordsFrom: null,
      recordsTo: null,
    },
  };
}

/** Doce meses, once cumplidos y abril nunca planificado. La métrica de §1. */
function view(): ComplianceView {
  const periods = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    const missed = month === '04';

    return {
      period_start: `2026-${month}-01`,
      period_months: 1 as const,
      period_end: `2026-${month}-28`,
      status: missed ? ('missed' as const) : ('completed' as const),
      scheduled_inspection_id: missed ? null : REPORT,
      template_id: null,
      template_version_id: null,
      inspection_id: missed ? null : REPORT,
      submitted_by: missed ? null : USER,
      occurred_at: missed ? null : `2026-${month}-20T14:00:00.000Z`,
      cancellation_reason: null,
    };
  });

  return {
    site_id: SITE,
    range_start: '2026-01-01',
    range_end: '2026-12-31',
    coverage: {
      required_count: 12,
      completed_count: 11,
      missed_count: 1,
      cancelled_count: 0,
      open_count: 0,
    },
    periods,
  };
}

function report(overrides: Partial<ComplianceReportSummary> = {}): ComplianceReportSummary {
  return {
    id: REPORT,
    site_id: SITE,
    range_start: '2026-01-01',
    range_end: '2026-12-31',
    payload_hash: HASH,
    generated_by: USER,
    generated_at: '2027-01-05T15:00:00.000Z',
    latest_render: null,
    ...overrides,
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ComplianceRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getCoverage.mockReset().mockResolvedValue(view());
  listReports.mockReset().mockResolvedValue([]);
  generateReport.mockReset();
  getDownloadUrl.mockReset();
  useAppSession.mockReset().mockReturnValue(session('hs_coordinator'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('la grilla de períodos', () => {
  it('muestra la cobertura como fracción y los doce meses', async () => {
    renderRoute();

    expect(await screen.findByText('11 of 12 required periods completed')).toBeTruthy();
    // `periodLabel` reemplazó al recorte `2026-04`: el nombre del período se escribe
    // igual acá, en la consola y en el PDF, o deja de ser el mismo período.
    expect(screen.getAllByText(/^[A-Z][a-z]+ 2026$/)).toHaveLength(12);
  });

  it('distingue el mes que nunca se planificó', async () => {
    renderRoute();

    expect(await screen.findByText('never scheduled')).toBeTruthy();
  });

  it('no muestra ningún porcentaje', async () => {
    // §5 riesgo E: el scoring salió de v1 y no vuelve por la ventana de una pantalla.
    const { container } = renderRoute();

    await screen.findByText('11 of 12 required periods completed');
    expect(container.textContent).not.toMatch(/\d\s*%/);
  });
});

describe('quién puede generar', () => {
  it('el coordinador ve el botón y genera', async () => {
    generateReport.mockResolvedValue(report());
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Generate report' });
    fireEvent.click(button);

    await waitFor(() => expect(generateReport).toHaveBeenCalledWith({
      siteId: SITE,
      rangeStart: expect.stringMatching(/^\d{4}-01-01$/),
      rangeEnd: expect.stringMatching(/^\d{4}-12-31$/),
    }));
  });

  it('un supervisor no ve el botón', async () => {
    useAppSession.mockReturnValue(session('supervisor'));
    renderRoute();

    await screen.findByText('11 of 12 required periods completed');
    expect(screen.queryByRole('button', { name: 'Generate report' })).toBeNull();
  });
});

describe('la lista de reportes', () => {
  it('muestra el digest COMPLETO, sin truncar', async () => {
    // Un digest truncado no se puede comparar carácter por carácter, y comparar es lo
    // único para lo que sirve.
    listReports.mockResolvedValue([report()]);
    renderRoute();

    const hash = await screen.findByText(HASH);

    expect(hash.textContent).toHaveLength(64);
  });

  it('un reporte sin render dice que el PDF todavía no está, y no ofrece descarga', async () => {
    listReports.mockResolvedValue([report()]);
    renderRoute();

    expect(await screen.findByText('The PDF is not ready yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  });

  it('un render fallido muestra su error y aclara que el reporte sigue intacto', async () => {
    listReports.mockResolvedValue([
      report({
        latest_render: {
          id: REPORT,
          report_id: REPORT,
          outcome: 'failed',
          object_key: null,
          error: 'Chromium timed out',
          rendered_at: '2027-01-05T15:00:12.000Z',
        },
      }),
    ]);

    renderRoute();

    expect(await screen.findByText(/Chromium timed out/)).toBeTruthy();
    expect(screen.getByText(/digest\s+are unaffected/)).toBeTruthy();
  });

  it('un render exitoso ofrece la descarga, y la URL se pide en el clic', async () => {
    // La URL firmada expira en minutos: pedirla al pintar la lista la dejaría vencida
    // para cuando alguien haga clic.
    getDownloadUrl.mockResolvedValue('https://bucket.example/signed');
    const open = vi.fn();
    vi.stubGlobal('open', open);

    listReports.mockResolvedValue([
      report({
        latest_render: {
          id: REPORT,
          report_id: REPORT,
          outcome: 'succeeded',
          object_key: 'key.pdf',
          error: null,
          rendered_at: '2027-01-05T15:00:12.000Z',
        },
      }),
    ]);

    renderRoute();

    const button = await screen.findByRole('button', { name: 'Download PDF' });
    expect(getDownloadUrl).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledWith(REPORT));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://bucket.example/signed', '_blank', 'noopener'),
    );

    vi.unstubAllGlobals();
  });
});
