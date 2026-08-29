import {
  countAnsweredBySection,
  evaluateVisibility,
  sectionsInDocumentOrder,
} from '@hs/forms';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { getSubmittedInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { Fact, Facts } from '../../components/Facts';
import { FindingReadout } from '../../components/FindingReadout';
import {
  CalendarIcon,
  ClockIcon,
  LockIcon,
  PersonIcon,
  PinIcon,
} from '../../components/icons';
import { TemplateSectionCard } from '../../components/TemplateSectionCard';
import { answersLabel, answerText } from '../../presentation/answers';
import { formatCivilDay, periodLabel } from '../../presentation/dates';
import { findingsLabel } from '../../presentation/findings';

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
 * SE DIBUJA COMO SE CAMINÓ. Las mismas tarjetas de sección numeradas y las mismas fichas
 * de pregunta que la captura, porque es la misma recorrida vista después: quien firmó
 * tiene que poder reconocer su propio recorrido, y quien audita tiene que poder seguirlo
 * contra el formulario. Lo único que cambia es que donde había un control ahora hay el
 * valor que quedó — ver el comentario de `answerText`.
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
          <Link className="back-link" to="/historical">
            Back to historical inspections
          </Link>
        </p>
      </>
    );
  }

  const report = submitted.data;
  const visibility = evaluateVisibility(report.document, report.answers);
  const findingsByItem = new Map(
    report.findings.map((finding) => [finding.item_key, finding] as const),
  );

  /**
   * El chip «N answers» de cada cabecera, contado por el motor y no por esta pantalla —
   * igual que en la captura. La regla de qué ítem se ve y cuál cuenta es la misma que
   * decidió si la inspección estaba completa al firmar; volver a escribirla acá daría un
   * número que puede discrepar del que dejó firmar.
   */
  const answeredBySection = new Map(
    countAnsweredBySection(report.document, report.answers).map((entry) => [
      entry.section_key,
      entry.answered,
    ]),
  );

  return (
    <div className="report">
      <nav className="report__nav" aria-label="Inspection navigation">
        <Link className="back-link" to="/historical">
          Back to historical inspections
        </Link>
      </nav>

      {/*
        El encabezado nombra QUÉ se está leyendo —la plantilla, que es lo que se reconoce—
        y la píldora dice en qué estado quedó. Es el mismo encabezado del recorrido y de la
        firma, así que la inspección se llama igual antes y después de enviarse.
      */}
      <header className="scheduling__header report__header">
        <div className="scheduling__title">
          <span className="scheduling__icon">
            <CalendarIcon size={22} />
          </span>
          <h1>{report.template_name}</h1>
          <span className="status-pill status-pill--completed">Accepted</span>
        </div>
        {/* El candado no decora: es lo único de la pantalla que dice que acá no se edita. */}
        <p className="scheduling__subtitle report__locked">
          <LockIcon size={16} />
          Submitted and accepted. This record cannot be changed.
        </p>
      </header>

      <Facts>
        <Fact
          icon={<CalendarIcon size={16} />}
          label="Month"
          value={periodLabel(report.period_start, report.period_months)}
        />

        <Fact
          icon={<PersonIcon size={16} />}
          label="Signed by"
          value={report.submitted_by_name ?? '—'}
        />

        <Fact
          icon={<ClockIcon size={16} />}
          label="Signed on"
          value={formatCivilDay(report.signed_at)}
          hints={[`Received ${formatCivilDay(report.received_at)}`]}
        />

        <Fact
          icon={<PinIcon size={16} />}
          label="Template version"
          value={`Version ${report.template_version}`}
          hints={[`${report.answer_count} answers recorded`]}
        />
      </Facts>

      {/*
        Las fotos y la firma se guardaron como object keys y todavía no se pueden mirar.
        Se dice acá, una vez y arriba: un registro que no declara la evidencia que tiene
        se lee como un registro que no la tiene.
      */}
      <p className="notice">
        Photos and the signature image are stored with this inspection but cannot be viewed
        yet. Where one exists, it is counted below.
      </p>

      {sectionsInDocumentOrder(report.document).map(([section, items], sectionIndex) => {
        const answered = items.filter((item) => visibility[item.item_key]);
        if (answered.length === 0) return null;

        const found = answered.filter((item) => findingsByItem.has(item.item_key)).length;

        return (
          <TemplateSectionCard
            key={section.section_key}
            section={section}
            index={sectionIndex}
            headerAccessory={
              <>
                <span className="status-pill status-pill--completed">
                  {answersLabel(answeredBySection.get(section.section_key) ?? 0)}
                </span>
                {/*
                  El segundo chip solo cuando hay hallazgos. Una sección limpia no dibuja
                  «0 findings»: el cero se lee como una casilla más que revisar, y lo que
                  esta pantalla tiene que dejar encontrar rápido es dónde hubo algo.
                */}
                {found > 0 ? (
                  <span className="status-pill status-pill--finding">{findingsLabel(found)}</span>
                ) : null}
              </>
            }
          >
            {answered.map((item, itemIndex) => {
              const finding = findingsByItem.get(item.item_key);
              const value = report.answers[item.item_key];

              return (
                <li key={item.item_key} className="report__item">
                  <span className="report__item-number" aria-hidden>
                    {itemIndex + 1}
                  </span>

                  <div className="report__item-body">
                    {/*
                      La pregunta a la izquierda y el valor contra el borde derecho, en la
                      misma columna en la que estuvo el control durante la recorrida. Sobre
                      cuarenta preguntas seguidas es lo que deja leer la columna de
                      respuestas de un vistazo en vez de cazarla al final de cada enunciado.
                    */}
                    <div className="report__item-line">
                      <p className="report__item-prompt">{item.prompt}</p>
                      <p
                        className={
                          value === undefined
                            ? 'report__answer report__answer--empty'
                            : 'report__answer'
                        }
                      >
                        {answerText(item, value)}
                      </p>
                    </div>

                    {/*
                      El mismo bloque que dibuja el recorte de hallazgos, y por eso vive en
                      `components/`. Solo cuando hay hallazgo: la acción correctiva que la
                      plantilla prescribe para una pregunta que salió limpia no es
                      información, y en un reporte de cuarenta preguntas sería ruido.
                    */}
                    {finding ? (
                      <FindingReadout
                        correctiveAction={item.finding?.corrective_action}
                        finding={finding}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </TemplateSectionCard>
        );
      })}
    </div>
  );
}
