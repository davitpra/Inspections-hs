import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  amendActionCommitmentRequestSchema,
  type ActionSummary,
  type AmendActionCommitmentRequest,
} from '@hs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { amendAssignment } from '../../api/actions';
import { listFindingRoster } from '../../api/findings';
import { queryKeys } from '../../api/query-keys';
import { futureDueAt, toDateTimeLocal } from './presentation';

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

  const submit = (): void => {
    if (amendment.isPending || !roster.isSuccess) return;

    if (!roster.data.some((person) => person.id === assigneePersonId)) {
      setValidationError('Choose an active assignee from this site.');
      return;
    }

    const deadline = futureDueAt(dueAt, new Date());
    if (!deadline.success) {
      setValidationError(deadline.message);
      return;
    }

    const request = amendActionCommitmentRequestSchema.safeParse({
      assignee_person_id: assigneePersonId,
      description,
      due_at: deadline.dueAt,
    });

    if (!request.success) {
      setValidationError(
        `Description must be between ${ACTION_DESCRIPTION_MIN} and ${ACTION_DESCRIPTION_MAX} characters.`,
      );
      return;
    }

    setValidationError(null);
    amendment.mutate(request.data);
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
      <label className="finding__create-field">
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

      <label className="finding__create-field">
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

      <label className="finding__create-field">
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
