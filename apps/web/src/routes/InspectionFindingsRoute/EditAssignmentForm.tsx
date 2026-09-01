import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  type ActionSummary,
  type AmendActionCommitmentRequest,
} from '@hs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { amendAssignment } from '../../api/actions';
import { listFindingRoster } from '../../api/findings';
import { queryKeys } from '../../api/query-keys';
import { commitmentRequest, toDateTimeLocal } from './presentation';

/**
 * El formulario que corrige responsable, trabajo y plazo mientras la acción sigue en
 * `open` (ADR-018), a la vista y sin nada modal.
 *
 * Es un REEMPLAZO completo, no un PATCH: los tres campos viajan siempre, precargados con
 * el compromiso vigente. Un envío correcto agrega una enmienda y el hallazgo se queda en
 * `assigned`; un envío rechazado conserva lo escrito para corregirlo.
 *
 * `Start work` cierra esta ventana: cuando eso pasa `nextStep` deja de traer `amend` y
 * este formulario no se dibuja. La garantía la da el servidor con `invalid_action_state`.
 */
export function EditAssignmentForm({
  action,
  findingId,
  onAmended,
}: {
  action: ActionSummary;
  findingId: string;
  onAmended: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();

  const [assigneePersonId, setAssigneePersonId] = useState(action.assignee_person_id);
  const [description, setDescription] = useState(action.description);
  const [dueAt, setDueAt] = useState(toDateTimeLocal(action.due_at));
  const [validationError, setValidationError] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: queryKeys.findingRoster(findingId),
    queryFn: () => listFindingRoster(findingId),
    retry: false,
  });

  const amendment = useMutation({
    mutationFn: (request: AmendActionCommitmentRequest) => amendAssignment(action.id, request),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.action(action.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submittedInspection() }),
      ]);
      onAmended();
    },
  });

  /*
    LA MISMA REGLA QUE AL ASIGNAR, y por eso no está escrita acá: enmendar es reemplazar el
    compromiso entero (ADR-018), así que lo que se comprueba es lo mismo. Con la comprobación
    copiada, la enmienda terminaría aceptando lo que crear rechaza.
  */
  const submit = (): void => {
    if (amendment.isPending || !roster.isSuccess) return;

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
    amendment.mutate(commitment.request);
  };

  return (
    <form
      className="finding__amend-form"
      aria-label="Edit assignment"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="finding__step-field">
        <span>Responsible person</span>
        <select
          value={assigneePersonId}
          disabled={!roster.isSuccess || amendment.isPending}
          aria-invalid={validationError?.startsWith('Choose an active assignee') || undefined}
          onChange={(event) => setAssigneePersonId(event.target.value)}
        >
          {roster.isSuccess ? null : (
            <option value={assigneePersonId}>
              {roster.isLoading ? 'Loading active people…' : 'Active people unavailable'}
            </option>
          )}
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
          disabled={amendment.isPending}
          aria-invalid={validationError?.startsWith('Description') || undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="finding__step-field">
        <span>Deadline</span>
        <input
          type="datetime-local"
          value={dueAt}
          disabled={amendment.isPending}
          aria-invalid={validationError?.toLowerCase().includes('deadline') || undefined}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </label>

      {validationError ? (
        <p role="alert" className="notice notice--warn">
          {validationError}
        </p>
      ) : null}

      {amendment.isError ? (
        <p role="alert" className="notice notice--warn">
          {amendment.error.message || 'The assignment could not be amended.'}
        </p>
      ) : null}

      <div className="finding__create-actions">
        <button
          className="button--primary"
          type="submit"
          disabled={!roster.isSuccess || amendment.isPending}
        >
          {amendment.isPending ? 'Saving…' : 'Save assignment'}
        </button>
      </div>
    </form>
  );
}
