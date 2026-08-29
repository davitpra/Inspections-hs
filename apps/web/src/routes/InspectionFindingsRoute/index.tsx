import type { ActionSummary, Finding } from '@hs/contracts';
import {
  evaluateVisibility,
  sectionsInDocumentOrder,
  type TemplateItem,
  type TemplateSection,
} from '@hs/forms';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { listActions } from '../../api/actions';
import { getSubmittedInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { Fact, Facts } from '../../components/Facts';
import { FindingReadout } from '../../components/FindingReadout';
import { StateBadge } from '../../components/StateBadge';
import {
  AlertCircleIcon,
  CalendarIcon,
  ClockIcon,
  PersonIcon,
  PlusIcon,
} from '../../components/icons';
import { TemplateSectionCard } from '../../components/TemplateSectionCard';
import { canCreateAction } from '../../permissions/actions';
import { answerText } from '../../presentation/answers';
import {
  actionDeadlineStatus,
  ACTION_DEADLINE_LABEL,
  escalationSummary,
} from '../../presentation/actions';
import { formatCivilDay, formatDay, periodLabel } from '../../presentation/dates';
import { findingsLabel } from '../../presentation/findings';
import { CreateActionForm } from './CreateActionForm';
import { ActionProgressDialog } from './ActionProgressDialog';
import { actionsByFinding } from './presentation';

type Overlay =
  | { kind: 'create'; finding: Finding }
  | { kind: 'progress'; actionId: string };

/**
 * Una inspección enviada, leída por lo que salió mal.
 *
 * Es `/inspections/$id/report` con un filtro y nada más: el mismo registro, el mismo
 * documento congelado, las mismas tarjetas de sección y las mismas fichas de pregunta.
 * Que se parezcan no es economía —quien firmó tiene que reconocer su propio recorrido, y
 * quien audita tiene que poder seguirlo contra el formulario—; lo único que cambia es que
 * las preguntas limpias no se dibujan.
 *
 * LA MISMA CONSULTA Y LA MISMA CLAVE QUE EL REPORTE, a propósito. Es el mismo envío leído
 * con otra pregunta, así que pasar de una pantalla a la otra no cuesta una llamada. Una
 * clave propia habría duplicado el pedido y, peor, dejado dos copias del mismo registro
 * pudiendo envejecer distinto.
 *
 * LA PREGUNTA SE DIBUJA JUNTO AL HALLAZGO, no sola. Un hallazgo sin el enunciado que lo
 * abrió es una queja suelta; con él es la respuesta negativa de un formulario, que es lo
 * que se defiende ante un regulador.
 *
 * Y POR ESO EL COMPROMISO SE ABRE ACÁ. El coordinador tiene a la vista las tres cosas que
 * necesita para decidirlo —lo que la plantilla prescribió, lo que el inspector observó, y
 * cuántas fotos lo respaldan—, que es justo lo que una tabla de hallazgos no puede dar. El
 * botón se ofrece solo a `hs_coordinator` y eso es comodidad, no garantía: el servidor
 * vuelve a exigirlo en `ActionsService.create`.
 *
 * Las acciones que un hallazgo YA tiene se leen para todos los roles. Saber qué se
 * comprometió no es un privilegio, y sin ese dato el coordinador abriría duplicados a
 * ciegas.
 *
 * De servidor y sin red no hay, igual que el reporte: el borrador local cubre los días
 * siguientes al envío y nada más (ADR-010). La creación tampoco tiene offline: una acción
 * correctiva se ejecuta con red (design D15).
 */
export function InspectionFindingsRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/findings/$id' });

  const { account } = useAppSession();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const returnFocusTo = useRef<HTMLElement>(null);

  const submitted = useQuery({
    queryKey: queryKeys.submittedInspection(id),
    queryFn: () => getSubmittedInspection(id),
    retry: false,
  });

  /*
    LA MISMA CLAVE QUE `/actions`, por lo mismo que el envío comparte la del reporte: es la
    misma pregunta hecha desde otra pantalla. Llegar acá desde las acciones correctivas no
    cuesta una llamada, y la invalidación que hace el diálogo al crear refresca las dos.
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
          This inspection could not be loaded. Submitted inspections are kept on the server,
          so reading one needs a connection.
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

  /*
    LOS HALLAZGOS SE LEEN DE LO QUE QUEDÓ GUARDADO, no se recalculan. `negativeAnswers` de
    `@hs/forms` es la regla que decidió en la captura y en la ingesta qué respuesta abría un
    hallazgo; volver a correrla acá sería una tercera opinión sobre un registro cerrado, y
    la primera vez que discrepara la pantalla mostraría algo que la tabla no dice.
  */
  const visibility = evaluateVisibility(report.document, report.answers);
  const findingsByItem = new Map(
    report.findings.map((finding) => [finding.item_key, finding] as const),
  );

  const existingActions = actionsByFinding(actions.data ?? []);
  const allowCreation = canCreateAction(account);

  /*
    Se resuelve la lista ANTES de dibujar porque hacen falta dos cosas de ella: saber si
    quedó algo (si no, la pantalla tiene que decirlo en vez de quedarse en blanco bajo un
    encabezado) y numerar las secciones sin huecos. La visibilidad se sigue evaluando
    contra las respuestas reales, así que una pregunta que una condición escondió durante
    el recorrido sigue escondida — un hallazgo huérfano de una pregunta que no se hizo no
    puede existir, y si existiera, esta pantalla no es donde se descubre.
  */
  const sections = sectionsInDocumentOrder(report.document)
    .map(([section, items]): [TemplateSection, TemplateItem[]] => [
      section,
      items.filter((item) => visibility[item.item_key] && findingsByItem.has(item.item_key)),
    ])
    .filter(([, items]) => items.length > 0);

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
          Only the questions that recorded a finding.{' '}
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
          value={report.submitted_by_name ?? '—'}
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
      */}
      {sections.length === 0 ? (
        <p className="notice">
          This inspection recorded no findings. Every question that was asked came back
          clear.
        </p>
      ) : null}

      {/*
        Las fotos viajaron como object keys y todavía no se pueden mirar. Se dice arriba y
        una vez: un registro que no declara la evidencia que tiene se lee como un registro
        que no la tiene.
      */}
      {sections.length > 0 ? (
        <p className="notice">
          Photos are stored with each finding but cannot be viewed yet. Where one exists, it
          is counted below.
        </p>
      ) : null}

      {/*
        Las secciones se numeran por su posición EN LO MOSTRADO y no en el documento. Los
        números salteados de la numeración original no dirían "acá hubo una sección limpia",
        dirían "esta pantalla perdió algo".
      */}
      {sections.map(([section, items], sectionIndex) => (
        <TemplateSectionCard
          key={section.section_key}
          section={section}
          index={sectionIndex}
          headerAccessory={
            <span className="status-pill status-pill--finding">
              {findingsLabel(items.length)}
            </span>
          }
        >
          {items.map((item, itemIndex) => {
            const finding = findingsByItem.get(item.item_key);
            const value = report.answers[item.item_key];

            return (
              <li key={item.item_key} className="report__item" tabIndex={-1}>
                <span className="report__item-number" aria-hidden>
                  {itemIndex + 1}
                </span>

                <div className="report__item-body">
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

                  {finding ? (
                    <>
                      <FindingReadout
                        correctiveAction={item.finding?.corrective_action}
                        finding={finding}
                      />
                      <FindingCommitments
                        actionsFailed={actions.isError}
                        allowCreation={allowCreation}
                        existing={existingActions.get(finding.id) ?? []}
                        onCreate={(container) => {
                          returnFocusTo.current = container;
                          setOverlay({ kind: 'create', finding });
                        }}
                        onProgress={(actionId, container) => {
                          returnFocusTo.current = container;
                          setOverlay({ kind: 'progress', actionId });
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </TemplateSectionCard>
      ))}

      {/*
        UN SOLO DIÁLOGO, fuera del bucle. Crear invalida `queryKeys.actions()` y con eso se
        vuelve a dibujar el ítem que lo abrió; un diálogo montado dentro de la fila se
        desmontaría a mitad de su propia mutación. Es el mismo motivo por el que los
        diálogos del roster viven fuera de la tabla.
      */}
      {overlay?.kind === 'create' ? (
        <CreateActionForm
          finding={overlay.finding}
          returnFocusTo={returnFocusTo}
          onClose={() => setOverlay(null)}
        />
      ) : overlay?.kind === 'progress' ? (
        <ActionProgressDialog
          actionId={overlay.actionId}
          returnFocusTo={returnFocusTo}
          onClose={() => setOverlay(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Lo que este hallazgo ya comprometió, y el camino para comprometer algo más.
 *
 * Aparte del bucle porque son tres estados y no uno —hay acciones, no hay ninguna, o no se
 * pudo saber— y meterlos inline dejaría el ítem ilegible.
 *
 * **CERO NO SE AFIRMA SIN HABER LEÍDO.** Con la consulta de acciones caída, "no actions
 * yet" sería una mentira con la misma cara que la verdad: el coordinador abriría un
 * duplicado creyendo que no había nada. Por eso el fallo se dice.
 */
function FindingCommitments({
  actionsFailed,
  allowCreation,
  existing,
  onCreate,
  onProgress,
}: {
  actionsFailed: boolean;
  allowCreation: boolean;
  existing: readonly ActionSummary[];
  onCreate: (container: HTMLElement) => void;
  onProgress: (actionId: string, container: HTMLElement) => void;
}): React.JSX.Element {
  return (
    <div className="finding__commitments">
      {actionsFailed ? (
        <p className="note">Existing corrective actions need a connection.</p>
      ) : existing.length === 0 ? (
        <p className="note">No corrective action yet.</p>
      ) : (
        <ul className="finding__actions">
          {existing.map((action) => {
            const deadlineStatus = actionDeadlineStatus(action.overdue, action.state);
            const escalation = escalationSummary(action.escalations);

            return (
              <li key={action.id} className="finding__action">
                <div className="finding__action-head">
                  <Link to="/actions/$id" params={{ id: action.id }}>
                    {action.description}
                  </Link>
                  <StateBadge state={action.state} />
                </div>
                <dl className="finding__action-facts">
                  <div>
                    <dt>Responsible</dt>
                    <dd>{action.assignee_name ?? 'Unknown assignee'}</dd>
                  </div>
                  <div>
                    <dt>{ACTION_DEADLINE_LABEL}</dt>
                    <dd>{formatDay(action.due_at)}</dd>
                  </div>
                </dl>
                {deadlineStatus ? <p className="finding__action-overdue">{deadlineStatus}</p> : null}
                {escalation ? (
                  <p className="finding__action-escalation">
                    <strong>Escalated</strong> {escalation}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="button--outline finding__update-button"
                  onClick={(event) => {
                    const container = event.currentTarget.closest<HTMLElement>('.report__item');
                    if (container) onProgress(action.id, container);
                  }}
                >
                  Update
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {allowCreation ? (
        <button
          type="button"
          className="finding__create-button"
          onClick={(event) => {
            const container = event.currentTarget.closest<HTMLElement>('.report__item');
            if (container) onCreate(container);
          }}
        >
          <PlusIcon size={16} /> Create corrective action
        </button>
      ) : null}
    </div>
  );
}
