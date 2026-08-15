import { useState } from 'react';
import type { ComplianceReportSummary } from '@hs/contracts';

import { getDownloadUrl } from '../../api/compliance';

/**
 * Un reporte ya generado.
 *
 * Los tres estados posibles del archivo se muestran los tres: descargable, todavía sin
 * archivo, o fallido con su error. El tercero es el que no se puede esconder — un
 * coordinador que ve «sin archivo» durante tres días tiene que poder saber que falló.
 */
export function ReportRow({ report }: { report: ComplianceReportSummary }): React.JSX.Element {
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
