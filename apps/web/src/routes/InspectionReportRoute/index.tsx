import { evaluateVisibility, sectionsInDocumentOrder } from '@hs/forms';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { getSubmittedInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { CalendarIcon, ClockIcon, PersonIcon, PinIcon } from '../../components/icons';
import { formatCivilDay, monthName } from '../../presentation/dates';
import { answerText, photoCountText } from './presentation';

/**
 * Una inspección enviada, leída de vuelta.
 *
 * Es el registro que la planta defiende ante un regulador, así que lo que se dibuja es lo
 * que quedó guardado y nada más: el documento CONGELADO con el que se contestó —no la
 * versión publicada hoy—, la respuesta de cada ítem, y el hallazgo que abrió cada respuesta
 * negativa.
 *
 * **Se recorre con la visibilidad resuelta contra las respuestas REALES**, así que una
 * pregunta que una condición escondió durante el recorrido está escondida acá también. Es
 * la decisión opuesta a la de la vista previa —que muestra el documento entero porque no
 * tiene respuestas— y por el mismo motivo: cada una tiene que describir la recorrida que le
 * corresponde. Dibujar el documento completo mostraría preguntas que nunca se hicieron y
 * las marcaría sin contestar, que se lee como una inspección incompleta.
 *
 * De servidor y sin red no hay: el borrador local cubre los días siguientes al envío y
 * nada más (ADR-010).
 */
export function InspectionReportRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/inspections/$id/report' });

  const submitted = useQuery({
    queryKey: queryKeys.submittedInspection(id),
    queryFn: () => getSubmittedInspection(id),
    retry: false,
  });

  if (submitted.isPending) return <p>Loading the inspection…</p>;

  if (submitted.isError || !submitted.data) {
    return (
      <>
        <h1>Inspection report</h1>
        <p className="notice notice--warn">
          This inspection could not be loaded. Submitted inspections are kept on the server,
          so reading one needs a connection.
        </p>
        <p>
          <Link to="/inspections/past">Back to past inspections</Link>
        </p>
      </>
    );
  }

  const report = submitted.data;
  const visibility = evaluateVisibility(report.document, report.answers);
  const findingsByItem = new Map(
    report.findings.map((finding) => [finding.item_key, finding] as const),
  );

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CalendarIcon size={22} />
            </span>
            <h1>{report.template_name}</h1>
          </div>
          <p className="scheduling__subtitle">
            {monthName(report.period_start)} {report.period_start.slice(0, 4)} — submitted and
            accepted. This record cannot be changed.
          </p>
        </div>
      </header>

      <p>
        <Link to="/inspections/past">← Back to past inspections</Link>
      </p>

      <dl className="facts">
        <div className="facts__item">
          <span className="facts__label">
            <CalendarIcon size={16} /> Month
          </span>
          <span className="facts__value">
            {monthName(report.period_start)} {report.period_start.slice(0, 4)}
          </span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PersonIcon size={16} /> Signed by
          </span>
          <span className="facts__value">{report.submitted_by_name ?? '—'}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <ClockIcon size={16} /> Signed on
          </span>
          <span className="facts__value">
            {formatCivilDay(report.signed_at)}
            <span className="facts__hint">Received {formatCivilDay(report.received_at)}</span>
          </span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PinIcon size={16} /> Template version
          </span>
          <span className="facts__value">
            Version {report.template_version}
            <span className="facts__hint">{report.answer_count} answers recorded</span>
          </span>
        </div>
      </dl>

      {/*
        Las fotos y la firma se guardaron como object keys y todavía no se pueden mirar.
        Se dice acá, una vez y arriba: un registro que no declara la evidencia que tiene
        se lee como un registro que no la tiene.
      */}
      <p className="notice">
        Photos and the signature image are stored with this inspection but cannot be viewed
        yet. Where one exists, it is counted below.
      </p>

      {sectionsInDocumentOrder(report.document).map(([section, items]) => {
        const answered = items.filter((item) => visibility[item.item_key]);
        if (answered.length === 0) return null;

        return (
          <section key={section.section_key}>
            <h2>{section.section_title}</h2>

            <ul className="grid--list">
              {answered.map((item) => {
                const finding = findingsByItem.get(item.item_key);

                return (
                  <li key={item.item_key} className="list__row list__row--stacked">
                    <p className="section-row__title">{item.prompt}</p>
                    <p className="facts__value">
                      {answerText(item, report.answers[item.item_key])}
                    </p>

                    {finding ? (
                      <div className="notice notice--warn">
                        <p>{finding.description}</p>
                        <p className="list__aside">
                          {photoCountText(finding.photo_object_keys.length)}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
