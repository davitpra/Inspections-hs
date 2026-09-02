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
  stageStatus,
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
 * **PERO EL CICLO LLEGA PLEGADO DONDE ESTÁ EN BLANCO**, detrás de un solo control que nombra
 * el acto. Una inspección recién enviada con seis hallazgos abría seis tiras de etapas vacías
 * y seis formularios de alta apilados, y pedía seis rosters —uno por hallazgo, ADR-017— antes
 * de que nadie mirara ninguno: la pantalla que existe para leer QUÉ SALIÓ MAL se leía como una
 * planilla de carga.
 *
 * El pliegue se retiró una vez porque cobraba una pulsación por hallazgo para ver en qué anda
 * cada uno. Ese precio se paga cuando hay algo escrito. **Un hallazgo levantado no anda en
 * nada**: no tiene compromiso, ni eventos, ni plazo, y su ciclo son cinco segmentos vacíos. Por
 * eso el pliegue se cuelga de `creating` —el alta, que `nextStep` solo ofrece sobre un hallazgo
 * levantado que quien lee puede asignar— y no del estado del hallazgo a secas: donde hay algo
 * que auditar, el ciclo se dibuja abierto.
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
 * **EL ALTA DESPLEGADA ES LA ÚNICA EXCEPCIÓN**, y se lee bajo `Assigned`, la etapa que va a
 * escribir. No paga aquel precio porque no hay ninguna etapa anterior con algo decidido que
 * esté tapando, y `Assigned` sale vacía diciéndolo. La excepción la produce el despliegue y no
 * el paso: `FindingNextStep` no declara qué etapa escribiría, lo decide `draft`, acá abajo.
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
  const [opened, setOpened] = useState(false);
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
  const bodyId = `${prefix}-body`;
  const creating = step?.control?.kind === "create";
  const collapsed = creating && !opened;
  /*
    LA ETAPA QUE LA COMPOSICIÓN DESPLEGADA ESCRIBIRÍA, y donde por eso se lee su formulario.
    Sale del despliegue y no del paso: sin desplegar no hay excepción que ofrecer, y un lector
    que no puede componer nada —`creating` en falso— nunca ve `Assigned` prometida ni pierde de
    vista los hechos del hallazgo, que es lo único que tiene para leer.
  */
  const draft = creating && opened ? ("assigned" as const) : null;

  /*
    EL ROSTER ES POR HALLAZGO Y SE PIDE AL DESPLEGAR, no al dibujar la pantalla. El endpoint es
    `/findings/:id/roster` porque quién puede recibir el trabajo depende de la planta de ESE
    hallazgo (ADR-017), así que no hay una consulta que sirva para todos: una inspección con
    seis hallazgos levantados pedía seis rosters al montar, y cinco eran para formularios que
    nadie iba a mirar.
  */
  const roster = useQuery({
    queryKey: queryKeys.findingRoster(finding.id),
    queryFn: () => listFindingRoster(finding.id),
    retry: false,
    enabled: creating && opened,
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
          type="date"
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
      {/*
        LOS CONTROLES DEL CICLO SON DOS ACTOS DISTINTOS. Crear despliega la composición y deja su
        lugar a `Hide form`, que puede plegarla sin descartar nada —el cuerpo se oculta, no se
        desmonta, y lo escrito sigue ahí—. Desplegar elige además la etapa que el formulario va
        a escribir, que es donde se lo lee.
      */}
      {creating ? (
        <div className="finding__lifecycle-toggle">
          {opened ? (
            <button
              type="button"
              className="finding__lifecycle-back"
              aria-controls={bodyId}
              onClick={() => setOpened(false)}
            >
              Hide form
            </button>
          ) : (
            <button
              type="button"
              className="button--primary"
              aria-expanded={false}
              aria-controls={bodyId}
              onClick={() => {
                setSelected("assigned");
                setOpened(true);
              }}
            >
              Create a corrective action
            </button>
          )}
        </div>
      ) : null}

      {/*
        SE OCULTA, NO SE DESMONTA. Plegar y volver a abrir tiene que devolver la etapa elegida y
        el compromiso a medio escribir donde estaban; desmontarlos los perdería sin decirlo, y
        entonces el control de arriba sería un `Cancel` disfrazado.
      */}
      <div className="finding__lifecycle-body" id={bodyId} hidden={collapsed}>
        {/* tira de 5 etapas */}
        <FindingStepper
          current={finding.state}
          deadline={findingDeadline(actions, finding.state, today)}
          selected={selected}
          draft={draft}
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
            pending={stageStatus(selected, finding.state) === "todo"}
          />
          {/* La etapa elegida*/}
          {step && selected === (draft ?? finding.state) ? (
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
      </div>
    </>
  );
}
