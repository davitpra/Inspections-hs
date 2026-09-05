import type { ActionSummary, Finding } from "@hs/contracts";
import { useQuery } from "@tanstack/react-query";

import { getAction } from "../../api/actions";
import { queryKeys } from "../../api/query-keys";
import { formatDay } from "../../presentation/dates";
import {
  eventsInStage,
  STAGE_LABELS,
  type FindingStage,
} from "./presentation";

/**
 * Lo que se decidió en UNA etapa, de solo lectura, en el mismo hueco donde la etapa vigente
 * ofrece su próximo paso (ADR-020).
 *
 * Se ve distinto del paso a propósito —filete neutro y no azul—: el paso es el único llamado
 * a la acción de la ficha, y si los dos se dibujaran igual, elegir una etapa pasada parecería
 * ofrecer algo que hacer en ella.
 *
 * Cada etapa contesta con lo que la conserva y no con el stream entero:
 *
 * - `raised` no consulta nada. El hallazgo ya viajó con la pantalla, y la etapa la abrió él.
 * - `assigned` presenta la única asignación vigente directamente desde el resumen.
 * - las demás abren esa MISMA asignación y debajo lo que se escribió en ellas: el motivo, la
 *   nota y la evidencia contada de cada paso.
 *
 * **TODA ETAPA CON ACCIONES EMPIEZA NOMBRANDO LA ACCIÓN**, y no el evento. `In progress`
 * contestaba «Start work» y el instante en que se registró, y ninguna de las dos cosas dice
 * qué trabajo se comprometió, quién lo debe ni para cuándo —que es contra lo que se juzga el
 * paso que se dio—. El instante se fue con ese renglón, y la etiqueta de la transición detrás:
 * las dos ocupaban los valores del registro para contestar algo que nadie estaba preguntando
 * ahí —`Start work` sobre la etapa `In progress` repite la etapa que ya nombra la tira—.
 *
 * Con varias acciones en la misma etapa, esa cabecera es además lo único que las distingue:
 * dos listas de eventos con las mismas etiquetas son indistinguibles.
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
 * El detalle se pide solo para las etapas que leen eventos. Assigned ya lleva sus valores vigentes
 * en `ActionSummary` y no paga otra consulta.
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
          No corrective action has been created yet. Assign someone and describe
          the work they need to complete.
        </p>
      ) : stage === "raised" ? (
        <dl className="finding__stage-record-facts">
          <div>
            <dt>Finding recorded date</dt>
            <dd>{formatDay(finding.recorded_at)}</dd>
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

/**
 * Qué se comprometió, con quién y para cuándo, leído de los valores VIGENTES del resumen.
 *
 * Son los vigentes y no los de un evento a propósito: la asignación se puede corregir hasta
 * el cierre (ADR-020), y lo que hay que tener a la vista mientras se juzga un paso es el
 * compromiso que rige hoy, no el que regía cuando alguien pulsó el botón.
 *
 * El título lo pone quien la dibuja porque la etapa cambia lo que la asignación ES ahí:
 * bajo `Assigned` es lo único que se decidió, y bajo las demás es el encabezado de lo que
 * se hizo con ella.
 */
function ActionIdentity({
  action,
  title,
}: {
  action: ActionSummary;
  title: string;
}): React.JSX.Element {
  return (
    <>
      <p className="finding__stage-record-title">{title}</p>
      <dl className="finding__stage-decision-values">
        <div>
          <dt>Responsible</dt>
          <dd>{action.assignee_name ?? "Assigned person"}</dd>
        </div>
        <div>
          <dt>Work</dt>
          <dd>{action.description}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatDay(action.due_at)}</dd>
        </div>
      </dl>
    </>
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
  if (stage === "assigned") {
    return <ActionIdentity action={action} title="Current assignment" />;
  }

  return (
    <>
      <ActionIdentity action={action} title="Corrective action" />
      <StageEvents actionId={action.id} stage={stage} />
    </>
  );
}

/**
 * Los pasos que se dieron sobre ESA acción dentro de la etapa.
 *
 * La consulta vive acá y no en `ActionStageRecord` porque es de los eventos y de nadie más:
 * `Assigned` no monta este componente, y así no necesita un `enabled` que apague una consulta
 * que igual se estaba pidiendo.
 *
 * **LA ACCIÓN YA SE NOMBRÓ ARRIBA**, antes de saber si el stream llegó: que los eventos no se
 * puedan leer no vuelve desconocido el compromiso del que se habla, y el aviso solo obligaría
 * a cambiar de etapa para averiguar a cuál pertenece.
 */
function StageEvents({
  actionId,
  stage,
}: {
  actionId: string;
  stage: FindingStage;
}): React.JSX.Element {
  const detail = useQuery({
    queryKey: queryKeys.action(actionId),
    queryFn: () => getAction(actionId),
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

  /*
    SOLO LOS EVENTOS QUE ESCRIBIERON ALGO. La etapa dejó de nombrar cada paso por su
    transición —`Action: Start work` sobre `In progress`, que es la etapa que se está
    leyendo— y con eso un paso sin razón, sin nota y sin evidencia no aporta ningún renglón:
    dibujarlo igual dejaría un hueco en blanco entre separadores.
  */
  const events = eventsInStage(detail.data.events, stage).filter(
    (event) => event.reason || event.note || event.evidence.length > 0,
  );

  if (events.length === 0) {
    return (
      <p className="finding__stage-record-eyebrow">
        Nothing was recorded here yet.
      </p>
    );
  }

  return (
    <ol className="finding__stage-decisions">
      {events.map((event) => {
        const before = event.evidence.filter(
          (item) => item.kind === "before",
        ).length;
        const after = event.evidence.filter(
          (item) => item.kind === "after",
        ).length;

        return (
          <li key={event.id} className="finding__stage-decision">
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
