import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CompliancePeriod, ComplianceReportSummary, PeriodStatus } from '@hs/contracts';

import { generateReport, getCoverage, getDownloadUrl, listReports } from '../api/compliance';
import { queryKeys } from '../api/query-keys';
import { useAppSession } from '../app/session-context';

/**
 * §3 R5 — La cobertura de períodos por planta, y la evidencia que se exporta de ella.
 *
 * Esta pantalla es el recorrido R5 entero: «el coordinador consulta, por sitio, la lista
 * de períodos con inspección completada vs. omitida, y exporta a PDF con hash del
 * contenido». Los dos números que importan —«11 de 12»— salen de acá.
 *
 * **SIN PORCENTAJE, SIN GRÁFICO Y SIN SEMÁFORO**, por el mismo motivo que la pantalla de
 * recurrencia no tiene línea de tendencia: un índice de cumplimiento es un número que hay
 * que defender —¿un mes cancelado lo baja?— y una fracción de períodos contados no. §5
 * riesgo E sacó el scoring de v1 y no vuelve por la ventana de una pantalla.
 *
 * **EL DIGEST SE MUESTRA ENTERO Y SE PUEDE COPIAR.** Truncarlo a ocho caracteres sería lo
 * lindo y lo inútil: un digest que no se puede comparar carácter por carácter no verifica
 * nada, y esta pantalla existe para que alguien pueda verificar.
 *
 * **Generar es del coordinador.** El botón no aparece para nadie más; el servidor lo
 * rechaza igual, y esa duplicación es deliberada: la comprobación del cliente evita
 * ofrecer algo que va a fallar, y la del servidor es la que manda.
 */
export function ComplianceRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const queryClient = useQueryClient();

  const siteId = account?.siteScope[0] ?? '';
  const [range, setRange] = useState(() => currentYear());

  const coverage = useQuery({
    queryKey: queryKeys.complianceCoverage(siteId, range.rangeStart, range.rangeEnd),
    queryFn: () => getCoverage({ siteId, ...range }),
    enabled: siteId !== '',
    retry: false,
  });

  const reports = useQuery({
    queryKey: queryKeys.complianceReports(siteId),
    queryFn: () => listReports(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => generateReport({ siteId, ...range }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.complianceReports(siteId) }),
  });

  const canGenerate = account?.role === 'hs_coordinator';

  return (
    <>
      <h1>Compliance</h1>

      <div className="filters">
        <label>
          Year
          <select
            value={range.rangeStart.slice(0, 4)}
            onChange={(event) => setRange(yearOf(Number(event.target.value)))}
          >
            {yearChoices().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      {coverage.isError ? <p className="notice">This view needs a connection.</p> : null}
      {coverage.isLoading ? <p>Loading…</p> : null}

      {coverage.data ? (
        <section>
          {/*
            La fracción, y nada más que la fracción. Es la métrica de §1 escrita como la
            escribe §1.
          */}
          <p className="fraction">
            {coverage.data.coverage.completed_count} of {coverage.data.coverage.required_count}{' '}
            required periods completed
          </p>

          <ul className="grid">
            {coverage.data.periods.map((period) => (
              <PeriodCell key={period.period_start} period={period} />
            ))}
          </ul>

          {coverage.data.coverage.open_count > 0 ? (
            <p className="note">
              {coverage.data.coverage.open_count} period(s) have not ended yet and are not
              counted as missed.
            </p>
          ) : null}

          {canGenerate ? (
            <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? 'Generating…' : 'Generate report'}
            </button>
          ) : null}

          {generate.isError ? <p className="notice">The report could not be generated.</p> : null}
        </section>
      ) : null}

      <h2>Generated reports</h2>

      {reports.data && reports.data.length === 0 ? (
        <p>No report has been generated for this site yet.</p>
      ) : null}

      <ul className="list">
        {reports.data?.map((report) => <ReportRow key={report.id} report={report} />)}
      </ul>
    </>
  );
}

/**
 * Un período de la grilla.
 *
 * LOS DOS `missed` SE DISTINGUEN EN EL TEXTO Y NO CON UN QUINTO ESTADO. Para el regulador
 * «se planificó y no se hizo» y «nunca se planificó» son los dos un mes sin inspección; el
 * empleador necesita saber cuál de los dos, porque uno es un problema de ejecución y el
 * otro del planificador.
 */
function PeriodCell({ period }: { period: CompliancePeriod }): React.JSX.Element {
  return (
    <li className={`period period--${period.status}`}>
      <span className="period__month">{monthLabel(period.period_start)}</span>
      <span className="period__status">{STATUS_LABELS[period.status]}</span>

      {period.status === 'missed' && period.scheduled_inspection_id === null ? (
        <span className="period__note">never scheduled</span>
      ) : null}

      {period.status === 'cancelled' && period.cancellation_reason ? (
        <span className="period__note">{period.cancellation_reason}</span>
      ) : null}
    </li>
  );
}

/**
 * Un reporte ya generado.
 *
 * Los tres estados posibles del archivo se muestran los tres: descargable, todavía sin
 * archivo, o fallido con su error. El tercero es el que no se puede esconder — un
 * coordinador que ve «sin archivo» durante tres días tiene que poder saber que falló.
 */
function ReportRow({ report }: { report: ComplianceReportSummary }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    try {
      // La URL firmada se pide EN EL CLIC y no al pintar la lista: expira en minutos.
      window.open(await getDownloadUrl(report.id), '_blank', 'noopener');
    } catch {
      setError('The download link could not be obtained.');
    }
  };

  return (
    <li className="report">
      <p>
        {report.range_start} to {report.range_end} &middot; generated {report.generated_at}
      </p>

      {/* Entero y copiable. Un digest truncado no verifica nada. */}
      <p className="report__hash">
        <code>{report.payload_hash}</code>
      </p>

      {report.latest_render?.outcome === 'succeeded' ? (
        <button type="button" onClick={() => void open()}>
          Download PDF
        </button>
      ) : null}

      {report.latest_render?.outcome === 'failed' ? (
        <p className="notice">
          The PDF could not be rendered: {report.latest_render.error}. The report and its digest
          are unaffected; rendering can be retried.
        </p>
      ) : null}

      {report.latest_render === null ? <p className="note">The PDF is not ready yet.</p> : null}

      {error ? <p className="notice">{error}</p> : null}
    </li>
  );
}

const STATUS_LABELS: Readonly<Record<PeriodStatus, string>> = {
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
  open: 'Still open',
};

/** `2026-04-01` → `2026-04`. La grilla es de meses, no de días. */
function monthLabel(periodStart: string): string {
  return periodStart.slice(0, 7);
}

function yearOf(year: number): { rangeStart: string; rangeEnd: string } {
  return { rangeStart: `${year}-01-01`, rangeEnd: `${year}-12-31` };
}

function currentYear(): { rangeStart: string; rangeEnd: string } {
  return yearOf(new Date().getFullYear());
}

/** El año en curso y los cuatro anteriores: el sistema no tiene datos más viejos. */
function yearChoices(): number[] {
  const current = new Date().getFullYear();
  return [0, 1, 2, 3, 4].map((offset) => current - offset);
}
