import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  type ActionSummary,
  type CreateActionRequest,
  type Finding,
  type Session,
} from '@hs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import { createAction } from '../../api/actions';
import { listFindingRoster } from '../../api/findings';
import { queryKeys } from '../../api/query-keys';
import { enclosingReportItem } from '../../components/ReportItem';
import { FindingNextStep } from './FindingNextStep';
import { FindingStageRecord } from './FindingStageRecord';
import { FindingStepper } from './FindingStepper';
import {
  commitmentRequest,
  findingDeadline,
  stageStatus,
  type FindingNextStep as NextStep,
  type FindingStage,
} from './presentation';

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
 * (`FindingNextStep`), y crear era el último acto que abría algo. El precio está anotado
 * abajo, en la consulta del roster.
 *
 * **El panel es uno y el hueco es el mismo.** Cada etapa abre lo que se decidió en ella, y la
 * que el paso va a escribir abre su formulario. Que todas compartan lugar es lo que hace que
 * leer el pasado no agregue pantalla ni empuje el paso fuera de la vista.
 *
 * **La lectura arranca en el borrador**, no en la etapa vigente: el formulario se lee en el
 * segmento que escribe. Y por eso avanzar mueve la lectura sola —al crear la acción, el paso
 * pasa a ser `Start work` y la lectura se para en `in_progress`—, con el seguimiento de
 * `finding.state` durante el render: si el hallazgo se movió mientras alguien leía una etapa
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
  const panelRef = useRef<HTMLDivElement>(null);
  /*
    LA ETAPA QUE EL PASO VA A ESCRIBIR, y donde por eso se lee su formulario: asignar se lee
    bajo `assigned` aunque el hallazgo siga en `raised`, y en cuanto la acción existe la lectura
    se corre sola a `in_progress`, que es donde vive `Start work`. `null` cuando no hay nada que
    pulsar —el paso espera a otro— y entonces el paso se lee en la etapa vigente.
  */
  const draft = step?.writes ?? null;
  const [selected, setSelected] = useState<FindingStage>(draft ?? finding.state);
  const [seen, setSeen] = useState<FindingStage>(finding.state);
  const [amendOpen, setAmendOpen] = useState(false);
  const [assigneePersonId, setAssigneePersonId] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (seen !== finding.state) {
    setSeen(finding.state);
    setSelected(draft ?? finding.state);
    // Nada quedó escrito: el paso que tenía la enmienda abierta ya no es este.
    setAmendOpen(false);
  }

  const tabId = (stage: FindingStage): string => `${prefix}-${stage}`;
  const panelId = `${prefix}-panel`;
  const creating = step?.control?.kind === 'create';

  /*
    EL ROSTER SE PIDE POR HALLAZGO Y NO AL ABRIR NADA, que es el precio de tener la decisión
    a la vista: una pantalla con varios hallazgos levantados pide uno por cada uno, porque el
    endpoint es `/findings/:id/roster` (ADR-017: quién puede recibir el trabajo depende de la
    planta de ESE hallazgo). Se paga en pedidos chicos y se cobra en que nadie tiene que abrir
    una ventana para ver a quién puede asignar.
  */
  const roster = useQuery({
    queryKey: queryKeys.findingRoster(finding.id),
    queryFn: () => listFindingRoster(finding.id),
    retry: false,
    enabled: creating,
  });

  /*
    EL FOCO VUELVE A LA FICHA cuando el compromiso queda escrito: el hallazgo pasa a
    `assigned`, este formulario deja de dibujarse y el botón que tenía el foco no sobrevive.
    Sin esto el foco caería al `body`. Diferido por lo mismo que en `FindingNextStep`: el
    formulario puede desaparecer antes de que el navegador pinte, y la ficha sigue ahí.
  */
  const returnFocus = (): void => {
    const card = panelRef.current ? enclosingReportItem(panelRef.current) : null;

    window.setTimeout(() => card?.focus(), 0);
  };

  const creation = useMutation({
    mutationFn: (request: CreateActionRequest) => createAction(finding.id, request),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submittedInspection() }),
      ]);
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
      <label className="finding__create-field">
        <span>Responsible person</span>
        <select
          value={assigneePersonId}
          disabled={!roster.isSuccess || creation.isPending}
          aria-invalid={validationError?.startsWith('Choose an active assignee') || undefined}
          onChange={(event) => setAssigneePersonId(event.target.value)}
        >
          <option value="">
            {roster.isLoading
              ? 'Loading active people…'
              : roster.isError
                ? 'Active people unavailable'
                : 'Choose an active person'}
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

      <label className="finding__create-field">
        <span>Description</span>
        <textarea
          value={description}
          minLength={ACTION_DESCRIPTION_MIN}
          maxLength={ACTION_DESCRIPTION_MAX}
          disabled={creation.isPending}
          aria-invalid={validationError?.startsWith('Description') || undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="finding__create-field">
        <span>Deadline</span>
        <input
          type="datetime-local"
          value={dueAt}
          disabled={creation.isPending}
          aria-invalid={validationError?.toLowerCase().includes('deadline') || undefined}
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
          {creation.error.message || 'The corrective action could not be created.'}
        </p>
      ) : null}

      <div className="finding__create-actions">
        <button
          className="button--primary"
          type="submit"
          disabled={!roster.isSuccess || creation.isPending}
        >
          {creation.isPending ? 'Creating…' : 'Create action'}
        </button>
      </div>
    </form>
  ) : null;

  return (
    <>
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

      {/*
        EL PANEL ES EL CONTENEDOR Y NO EL BLOQUE: arriba el registro de la etapa elegida —vacío
        y diciéndolo cuando esa etapa es la que se está por escribir— y abajo el próximo paso,
        cuando esa etapa es la que el paso escribe. Cada uno conserva su región con nombre
        propio —"Assigned record", "Next step"—, que es como se los nombra en pantalla y como se
        los busca, y el `tabpanel` sigue siendo uno solo, que es lo que la pestaña controla.

        SIN BORRADOR, EL PASO SE LEE EN LA ETAPA VIGENTE: es el paso que no ofrece nada que
        pulsar —"Waiting on: …"—, y no hay ningún segmento por delante que le corresponda.
      */}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(selected)}
        tabIndex={-1}
        ref={panelRef}
      >
        <FindingStageRecord
          stage={selected}
          finding={finding}
          actions={actions}
          pending={stageStatus(selected, finding.state) === 'todo'}
        />
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
    </>
  );
}
