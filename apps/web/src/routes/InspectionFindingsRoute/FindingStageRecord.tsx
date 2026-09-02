import type { ActionSummary, Finding } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';

import { getAction } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { formatDay, formatInstant } from '../../presentation/dates';
import {
  commitmentLabel,
  eventLabel,
  eventsInStage,
  STAGE_LABELS,
  type FindingStage,
} from './presentation';

/**
 * Lo que se decidió en UNA etapa, de solo lectura, en el mismo hueco donde la etapa vigente
 * ofrece su próximo paso (ADR-018).
 *
 * Se ve distinto del paso a propósito —filete neutro y no azul—: el paso es el único llamado
 * a la acción de la ficha, y si los dos se dibujaran igual, elegir una etapa pasada parecería
 * ofrecer algo que hacer en ella.
 *
 * Cada etapa contesta con lo que la conserva y no con el stream entero:
 *
 * - `raised` no consulta nada. El hallazgo ya viajó con la pantalla, y la etapa la abrió él.
 * - `assigned` son los compromisos: el original y cada enmienda, que es lo único que esa
 *   etapa decide. Se dibuja también sin enmiendas, porque ahora es la respuesta a una
 *   pregunta que alguien hizo y no un aviso que aparece solo.
 * - las demás son los eventos que las escribieron, con su nota, su motivo y su evidencia
 *   contada.
 *
 * **La etapa vigente nunca sale vacía**: el paso se lee en la etapa desde la que se ejecuta, y
 * esa etapa ya ocurrió. La que SÍ sale vacía es la que una composición desplegada está por
 * escribir (`pending`), y lo dice: sin ese renglón el panel abriría con el encabezado
 * `Assigned`, nada, y «Next step» debajo, y quien completa el compromiso no tendría qué lo
 * ubique en la etapa.
 *
 * **NO HABER REGISTRADO NADA NO ES NO PODER LEER EL REGISTRO**, y por eso son dos ramas. La
 * segunda vale sobre una etapa alcanzada cuyas acciones no llegaron; anunciarla sobre un
 * hallazgo levantado, que no tiene ninguna, sería falso.
 *
 * El detalle viaja completo en `getAction` —eventos y compromisos juntos—, así que no hay una
 * llamada por versión; y como se dibuja una sola etapa por vez, tampoco una por etapa.
 */
export function FindingStageRecord({
  stage,
  finding,
  actions,
  pending = false,
}: {
  stage: FindingStage;
  finding: Finding;
  actions: readonly ActionSummary[];
  /** La etapa todavía no ocurrió: es la que la composición a la vista va a escribir. */
  pending?: boolean;
}): React.JSX.Element {
  return (
    <section
      className="finding__stage-record"
      aria-label={`${STAGE_LABELS[stage]} record`}
    >
      <p className="finding__stage-record-eyebrow">{STAGE_LABELS[stage]}</p>

      {/* La misma voz que la etapa alcanzada sin eventos: es la misma ausencia. */}
      {pending ? (
        <p className="finding__stage-record-eyebrow">
          Nothing has been recorded here yet. The step below is what writes it.
        </p>
      ) : stage === 'raised' ? (
        <dl className="finding__stage-record-facts">
          <div>
            <dt>Reported</dt>
            <dd>{formatInstant(finding.occurred_at)}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{formatInstant(finding.recorded_at)}</dd>
          </div>
          <div>
            <dt>Photos</dt>
            <dd>{finding.photo_object_keys.length}</dd>
          </div>
        </dl>
      ) : actions.length === 0 ? (
        <p className="notice notice--warn">
          The record of this stage needs a connection.
        </p>
      ) : (
        actions.map((action) => (
          <ActionStageRecord key={action.id} action={action} stage={stage} />
        ))
      )}
    </section>
  );
}

/** El aporte de UNA acción a la etapa elegida. */
function ActionStageRecord({
  action,
  stage,
}: {
  action: ActionSummary;
  stage: FindingStage;
}): React.JSX.Element {
  const detail = useQuery({
    queryKey: queryKeys.action(action.id),
    queryFn: () => getAction(action.id),
    retry: false,
  });

  if (detail.isPending) return <p>Loading the stage record…</p>;

  if (detail.isError || !detail.data) {
    return (
      <p className="notice notice--warn">
        The record of this stage needs a connection.
      </p>
    );
  }

  if (stage === 'assigned') {
    return (
      <ol className="finding__stage-decisions">
        {detail.data.commitments.map((commitment) => (
          <li key={commitment.id} className="finding__stage-decision">
            <p className="finding__stage-record-eyebrow">
              {commitmentLabel(commitment.position)}
            </p>
            <dl className="finding__stage-decision-values">
              <div>
                <dt>Responsible</dt>
                <dd>{commitment.assignee_name ?? 'Assigned person'}</dd>
              </div>
              <div>
                <dt>Work</dt>
                <dd>{commitment.description}</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>{formatDay(commitment.due_at)}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{formatInstant(commitment.occurred_at)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    );
  }

  const events = eventsInStage(detail.data.events, stage);

  if (events.length === 0) {
    return <p className="finding__stage-record-eyebrow">Nothing was recorded here yet.</p>;
  }

  return (
    <ol className="finding__stage-decisions">
      {events.map((event) => {
        const before = event.evidence.filter((item) => item.kind === 'before').length;
        const after = event.evidence.filter((item) => item.kind === 'after').length;

        return (
          <li key={event.id} className="finding__stage-decision">
            <p className="finding__stage-decision-action">
              <span>Action</span>
              {eventLabel(event)}
            </p>
            <p className="finding__stage-decision-value">
              <span>Recorded</span>
              {formatInstant(event.occurred_at)}
            </p>
            {event.reason ? (
              <p className="finding__stage-decision-note">
                <span>Reason</span>
                {event.reason}
              </p>
            ) : null}
            {event.note ? (
              <p className="finding__stage-decision-note">
                <span>Note</span>
                {event.note}
              </p>
            ) : null}
            {event.evidence.length > 0 ? (
              <p className="finding__stage-decision-evidence">
                <span>Evidence</span>
                {before} before, {after} after
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
