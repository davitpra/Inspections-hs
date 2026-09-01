import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  type ActionSummary,
  type CreateActionRequest,
  type Finding,
  type Session,
} from "@hs/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { createAction } from "../../api/actions";
import { listFindingRoster } from "../../api/findings";
import { queryKeys } from "../../api/query-keys";
import { useReturnToReportItem } from "../../components/ReportItem";
import { FindingNextStep } from "./FindingNextStep";
import { FindingStageRecord } from "./FindingStageRecord";
import { FindingStepper } from "./FindingStepper";
import {
  commitmentRequest,
  findingDeadline,
  type FindingNextStep as NextStep,
  type FindingStage,
} from "./presentation";

/**
 * El ciclo de UN hallazgo: la tira de etapas, el panel que la etapa elegida abre, y el
 * compromiso que el próximo paso pide escribir.
 *
 * Existe como componente porque la etapa elegida es estado POR hallazgo y el ciclo se dibuja
 * dentro del recorrido de las preguntas: en la ruta, ese estado sería uno solo para todas las
 * fichas y elegir una etapa las movería todas.
 *
 * **LA DECISIÓN SE TOMA ACÁ Y NO EN UNA VENTANA.** Asignar responsable, describir el trabajo
 * y comprometer una fecha era un diálogo, y un diálogo tapaba justo lo que justifica esos
 * tres campos: el enunciado de la plantilla, lo que el inspector observó y las fotos que lo
 * respaldan. Es el mismo argumento por el que avanzar una acción ya se resuelve en la ficha
 * (`FindingNextStep`), y crear era el último acto que abría algo.
 *
 * **Y EL CICLO ESTÁ SIEMPRE A LA VISTA.** Llegó a estar plegado detrás de un control con el
 * nombre del paso, para que una inspección recién enviada con seis hallazgos no apilara seis
 * formularios de alta; el precio era una pulsación por hallazgo para ver en qué anda cada uno,
 * sobre la pantalla que existe justamente para leer eso. Es el mismo argumento por el que el
 * compromiso no vive en un diálogo: lo que hay que decidir no se esconde bajo un botón.
 *
 * **El panel es uno y el hueco es el mismo.** Cada etapa abre lo que se decidió en ella, y la
 * vigente abre además el formulario de lo que sigue. Que todas compartan lugar es lo que hace
 * que leer el pasado no agregue pantalla ni empuje el paso fuera de la vista.
 *
 * **EL PASO SE LEE EN LA ETAPA DESDE LA QUE SE EJECUTA**, que es la vigente, y por eso la
 * lectura arranca ahí. Llegó a leerse en la etapa DESTINO —`Start work` bajo `In progress`,
 * que todavía no había ocurrido—, y el precio era un registro vacío arriba del paso en las
 * tres etapas donde hay algo decidido: el compromiso escrito quedaba una pestaña atrás de
 * donde alguien estaba mirando, en la pantalla que existe para leerlo.
 *
 * Avanzar mueve la lectura sola, con el seguimiento de `finding.state` durante el render: si el hallazgo se movió mientras alguien leía una etapa
 * pasada, quedarse donde estaba dejaría la ficha mostrando un registro viejo justo después
 * del acto que la cambió, que es el momento en que hay que ver qué sigue.
 *
 * SEGUIR EL ESTADO NO ES LO MISMO QUE REMONTARSE con una `key`: la mutación que mueve el
 * hallazgo de `raised` a `assigned` se envía desde este componente, y remontarlo sería
 * desmontar el formulario a mitad de su propio envío. Lo que sí se remonta es el próximo
 * paso, que es donde vive el estado que hay que soltar al avanzar.
 */
export function FindingLifecycle({
  finding,
  actions,
  step,
  session,
  today,
}: {
  finding: Finding;
  /** Las acciones de ESTE hallazgo; vacío cuando la lista no se pudo leer. */
  actions: readonly ActionSummary[];
  step: NextStep | null;
  session: Session | null;
  today: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const prefix = useId();
  const { ref: panelRef, returnFocus } =
    useReturnToReportItem<HTMLDivElement>();
  const [selected, setSelected] = useState<FindingStage>(finding.state);
  const [seen, setSeen] = useState<FindingStage>(finding.state);
  const [amendOpen, setAmendOpen] = useState(false);
  const [assigneePersonId, setAssigneePersonId] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (seen !== finding.state) {
    setSeen(finding.state);
    setSelected(finding.state);
    // Nada quedó escrito: el paso que tenía la enmienda abierta ya no es este.
    setAmendOpen(false);
  }

  const tabId = (stage: FindingStage): string => `${prefix}-${stage}`;
  const panelId = `${prefix}-panel`;
  const creating = step?.control?.kind === "create";

  /*
    EL ROSTER ES POR HALLAZGO, y solo lo pide el hallazgo que ofrece asignar. El endpoint es
    `/findings/:id/roster` porque quién puede recibir el trabajo depende de la planta de ESE
    hallazgo (ADR-017), así que no hay una consulta que sirva para todos: colgarlo de
    `creating` deja fuera a los hallazgos que ya están en marcha o cerrados, que son los que
    no tienen a quién asignar.
  */
  const roster = useQuery({
    queryKey: queryKeys.findingRoster(finding.id),
    queryFn: () => listFindingRoster(finding.id),
    retry: false,
    enabled: creating,
  });

  const creation = useMutation({
    mutationFn: (request: CreateActionRequest) =>
      createAction(finding.id, request),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.submittedInspection(),
        }),
      ]);
      // El hallazgo pasa a `assigned` y este formulario deja de dibujarse: el foco vuelve a
      // la ficha, que es lo único que sobrevive al acto (ver `useReturnToReportItem`).
      returnFocus();
    },
  });

  const submit = (): void => {
    if (creation.isPending || !roster.isSuccess) return;

    const commitment = commitmentRequest(
      { assigneePersonId, description, dueAt },
      roster.data,
      new Date(),
    );

    if (!commitment.success) {
      setValidationError(commitment.message);
      return;
    }

    setValidationError(null);
    creation.mutate(commitment.request);
  };

  /*
    EL FORMULARIO DEL PASO, y no un bloque aparte: se lo dibuja `FindingNextStep` en el mismo
    hueco donde va el control de una transición, para que el paso tenga una sola forma. Vive
    acá arriba —y no en ese componente— porque lo que decide es el ciclo del hallazgo.
  */
  const commitmentForm = creating ? (
    <form
      className="finding__create-form"
      aria-label="Create corrective action"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="finding__step-field">
        <span>Responsible person</span>
        <select
          value={assigneePersonId}
          disabled={!roster.isSuccess || creation.isPending}
          aria-invalid={
            validationError?.startsWith("Choose an active assignee") ||
            undefined
          }
          onChange={(event) => setAssigneePersonId(event.target.value)}
        >
          <option value="">
            {roster.isLoading
              ? "Loading active people…"
              : roster.isError
                ? "Active people unavailable"
                : "Choose an active person"}
          </option>
          {roster.data?.map((person) => (
            <option key={person.id} value={person.id}>
              {person.first_name} {person.last_name} ({person.employee_number})
            </option>
          ))}
        </select>
      </label>

      {roster.isError ? (
        <p role="alert" className="notice notice--warn">
          The active people for this site need a connection.
        </p>
      ) : null}

      <label className="finding__step-field">
        <span>Description</span>
        <textarea
          value={description}
          minLength={ACTION_DESCRIPTION_MIN}
          maxLength={ACTION_DESCRIPTION_MAX}
          disabled={creation.isPending}
          aria-invalid={validationError?.startsWith("Description") || undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="finding__step-field">
        <span>Deadline</span>
        <input
          type="datetime-local"
          value={dueAt}
          disabled={creation.isPending}
          aria-invalid={
            validationError?.toLowerCase().includes("deadline") || undefined
          }
          onChange={(event) => setDueAt(event.target.value)}
        />
      </label>

      {validationError ? (
        <p role="alert" className="notice notice--warn">
          {validationError}
        </p>
      ) : null}

      {creation.isError ? (
        <p role="alert" className="notice notice--warn">
          {creation.error.message ||
            "The corrective action could not be created."}
        </p>
      ) : null}

      <div className="finding__create-actions">
        <button
          className="button--primary"
          type="submit"
          disabled={!roster.isSuccess || creation.isPending}
        >
          {creation.isPending ? "Creating…" : "Create action"}
        </button>
      </div>
    </form>
  ) : null;

  return (
    <>
      {/* tira de 5 etapas */}
      <FindingStepper
        current={finding.state}
        deadline={findingDeadline(actions, finding.state, today)}
        selected={selected}
        locked={amendOpen}
        onSelect={setSelected}
        tabId={tabId}
        panelId={panelId}
      />

      {/* un panel*/}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(selected)}
        tabIndex={-1}
        ref={panelRef}
      >
        {/* que se eligio en cada etapa.  */}
        <FindingStageRecord
          stage={selected}
          finding={finding}
          actions={actions}
        />
        {/* La etapa elegida*/}
        {step && selected === finding.state ? (
          <FindingNextStep
            // El paso se suelta entero al avanzar: la enmienda desplegada era de la etapa
            // anterior. El compromiso, que sí tiene que sobrevivir a su propio envío, no
            // vive acá adentro.
            key={finding.state}
            step={step}
            session={session}
            findingId={finding.id}
            create={commitmentForm}
            onDraftChange={setAmendOpen}
          />
        ) : null}
      </div>
    </>
  );
}
