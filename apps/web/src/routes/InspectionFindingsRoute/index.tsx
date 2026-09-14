import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import { listActions } from "../../api/actions";
import { getSubmittedInspection } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { Fact, Facts } from "../../components/Facts";
import { FindingReadout } from "../../components/FindingReadout";
import {
  AlertCircleIcon,
  CalendarIcon,
  ClockIcon,
  PersonIcon,
} from "../../components/icons";
import { ReportItem } from "../../components/ReportItem";
import { TemplateSectionCard } from "../../components/TemplateSectionCard";
import {
  civilToday,
  formatCivilDay,
  periodLabel,
} from "../../presentation/dates";
import { findingsLabel } from "../../presentation/findings";
import { FindingLifecycle } from "./FindingLifecycle";
import {
  actionsByFinding,
  nextStep,
  sectionsWithFindings,
} from "./presentation";

/**
 * Una inspección enviada, leída por lo que salió mal.
 *
 * Es `/inspections/$id/report` con un filtro y nada más: el mismo registro, el mismo
 * documento congelado, las mismas tarjetas de sección y las mismas fichas de pregunta —de
 * ahí que `ReportItem` y `FindingReadout` vivan en `components/`—. Que se parezcan no es
 * economía —quien firmó tiene que reconocer su propio recorrido, y quien audita tiene que
 * poder seguirlo contra el formulario—; lo único que cambia es que las preguntas limpias
 * no se dibujan.
 *
 * LA MISMA CONSULTA Y LA MISMA CLAVE QUE EL REPORTE, a propósito. Es el mismo envío leído
 * con otra pregunta, así que pasar de una pantalla a la otra no cuesta una llamada. Una
 * clave propia habría duplicado el pedido y, peor, dejado dos copias del mismo registro
 * pudiendo envejecer distinto.
 *
 * LA PREGUNTA SE DIBUJA JUNTO AL HALLAZGO, no sola. Un hallazgo sin el enunciado que lo
 * abrió es una queja suelta; con él es la respuesta negativa de un formulario, que es lo
 * que se defiende ante un regulador. El recorte lo arma `sectionsWithFindings`.
 *
 * Y POR ESO EL COMPROMISO SE ABRE ACÁ. Quien decide tiene a la vista las tres cosas que
 * necesita —lo que la plantilla prescribió, lo que el inspector observó, y cuántas fotos
 * lo respaldan—, que es justo lo que una tabla de hallazgos no puede dar. Se ofrece
 * dentro del próximo paso y solo mientras crear ES el próximo paso; a quién, lo decide
 * `nextStep`, y eso es comodidad, no garantía: el servidor vuelve a exigirlo en
 * `ActionsService.create`. La ruta no dibuja esos campos ni sabe cuál ficha los está
 * llenando: los pone el ciclo del hallazgo.
 *
 * LA PANTALLA ABRE POR LA LECTURA —la pregunta, lo prescrito, lo observado, las fotos— y el
 * ciclo de cada hallazgo va abajo, a la vista. Estuvo plegado detrás de un control, para que
 * una inspección recién enviada con seis hallazgos no apilara seis formularios de alta; el
 * precio era una pulsación por hallazgo para ver en qué anda cada uno.
 *
 * El estado sale del stream propio que ya trae el hallazgo. Las acciones se leen para el
 * próximo paso, el plazo y la historia; si esa consulta falla, el estado sigue siendo legible
 * pero no se inventa qué trabajo queda por hacer.
 *
 * De servidor y sin red no hay, igual que el reporte: el borrador local cubre los días
 * siguientes al envío y nada más (ADR-010). La creación tampoco tiene offline: una acción
 * correctiva se ejecuta con red (design D15).
 */
export function InspectionFindingsRoute(): React.JSX.Element {
  const { id } = useParams({ from: "/findings/$id" });

  const { account } = useAppSession();

  const submitted = useQuery({
    queryKey: queryKeys.submittedInspection(id),
    queryFn: () => getSubmittedInspection(id),
    retry: false,
  });

  /*
    LA MISMA CLAVE QUE `/actions`, por lo mismo que el envío comparte la del reporte: es la
    misma pregunta hecha desde otra pantalla. Llegar acá desde las acciones correctivas no
    cuesta una llamada, y la invalidación que hace el ciclo al crear refresca las dos.
  */
  const actions = useQuery({
    queryKey: queryKeys.actions(),
    queryFn: listActions,
    retry: false,
  });

  if (submitted.isPending) return <p>Loading the inspection…</p>;

  if (submitted.isError || !submitted.data) {
    return (
      <>
        <h1>Inspection findings</h1>
        <p className="notice notice--warn">
          This inspection could not be loaded. Submitted inspections are kept on
          the server, so reading one needs a connection.
        </p>
        <p>
          <Link className="back-link" to="/findings">
            Back to findings
          </Link>
        </p>
      </>
    );
  }

  const report = submitted.data;
  const sections = sectionsWithFindings(
    report.document,
    report.answers,
    report.findings,
  );
  const existingActions = actionsByFinding(actions.data ?? []);
  const today = civilToday();

  return (
    <div className="report">
      <nav className="report__nav" aria-label="Inspection navigation">
        <Link className="back-link" to="/findings">
          Back to findings
        </Link>
      </nav>

      <header className="scheduling__header report__header">
        <div className="scheduling__title">
          <span className="scheduling__icon">
            <AlertCircleIcon size={22} />
          </span>
          <h1>{report.template_name}</h1>
        </div>
        {/*
          Se dice que esto es un recorte, y se ofrece el entero. Sin esa frase la pantalla
          se leería como la inspección completa y las preguntas que faltan parecerían
          preguntas sin contestar.
        */}
        <p className="scheduling__subtitle">
          Only the questions that recorded a finding.{" "}
          <Link to="/inspections/$id/report" params={{ id }}>
            Read the full inspection
          </Link>
          .
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
          value={report.submitted_by_name ?? "—"}
        />

        <Fact
          icon={<ClockIcon size={16} />}
          label="Signed on"
          value={formatCivilDay(report.signed_at)}
        />

        <Fact
          icon={<AlertCircleIcon size={16} />}
          label="Findings"
          value={findingsLabel(report.findings.length)}
        />
      </Facts>

      {/*
        Cero secciones con un envío que sí cargó: la inspección se cerró limpia. Se llega
        acá por URL escrita a mano, así que hay que contestarla en vez de dejar el
        encabezado solo, que se leería como una pantalla rota.

        Y donde sí hay algo, el aviso de las fotos: viajaron como object keys y todavía no
        se pueden mirar. Se dice arriba y una vez —un registro que no declara la evidencia
        que tiene se lee como un registro que no la tiene—, pero no sobre una pantalla que
        no tiene ningún hallazgo que respaldar.
      */}
      {sections.length === 0 ? (
        <p className="notice">
          This inspection recorded no findings. Every question that was asked
          came back clear.
        </p>
      ) : (
        <p className="notice">
          Photos are stored with each finding but cannot be viewed yet. Where
          one exists, it is counted below.
        </p>
      )}

      {sections.length > 0 && actions.isError ? (
        <p className="notice notice--warn">
          Existing follow-ups need a connection.
        </p>
      ) : null}

      {/*
        Las secciones se numeran por su posición EN LO MOSTRADO y no en el documento. Los
        números salteados de la numeración original no dirían "acá hubo una sección limpia",
        dirían "esta pantalla perdió algo".
      */}
      {sections.map(([section, found], sectionIndex) => (
        <TemplateSectionCard
          key={section.section_key}
          section={section}
          index={sectionIndex}
          headerAccessory={
            <span className="status-pill status-pill--finding">
              {findingsLabel(found.length)}
            </span>
          }
        >
          {found.map(({ item, finding }, itemIndex) => {
            const existing = existingActions.get(finding.id) ?? [];
            const step = actions.isError
              ? null
              : nextStep(existing, finding.state, account, finding);

            return (
              <ReportItem
                key={item.item_key}
                focusable
                index={itemIndex}
                item={item}
                value={report.answers[item.item_key]}
              >
                <>
                  <FindingReadout
                    correctiveAction={item.finding?.corrective_action}
                    finding={finding}
                  />
                  {/*
                    EL CICLO ES NAVEGABLE: la etapa vigente ofrece el próximo paso y cada
                    etapa ya alcanzada abre, en ese mismo hueco, lo que se decidió en ella
                    (ADR-021). La etapa elegida es estado por hallazgo —y la asignación que
                    se escribe en la etapa vigente, también—, y por eso las dos cosas viven
                    adentro de `FindingLifecycle` y no acá.
                  */}
                  <FindingLifecycle
                    finding={finding}
                    actions={actions.isError ? [] : existing}
                    step={step}
                    session={account}
                    today={today}
                  />
                </>
              </ReportItem>
            );
          })}
        </TemplateSectionCard>
      ))}
    </div>
  );
}
