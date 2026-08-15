import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { generateReport, getCoverage, listReports } from '../../api/compliance';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { canGenerateComplianceReport } from '../permissions';
import { PeriodCell } from './PeriodCell';
import { ReportRow } from './ReportRow';
import { yearChoices, yearOf } from './presentation';

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
  const [range, setRange] = useState(() => yearOf(new Date().getFullYear()));

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

  const canGenerate = canGenerateComplianceReport(account);

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
            {yearChoices(new Date().getFullYear()).map((year) => (
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
