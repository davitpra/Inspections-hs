import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  type ActionSummary,
  type ReplaceActionAssignmentRequest,
} from '@hs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { replaceAssignment } from '../../api/actions';
import { listFindingRoster } from '../../api/findings';
import { queryKeys } from '../../api/query-keys';
import { commitmentRequest, toDateTimeLocal } from './presentation';

/**
 * El formulario que corrige responsable, trabajo y plazo mientras la acción siga
 * abierta (ADR-020), a la vista y sin nada modal.
 *
 * Es un REEMPLAZO completo, no un PATCH: los tres campos viajan siempre, precargados con
 * la asignación vigente. Un envío correcto reemplaza esos valores sin cambiar el estado;
 * un envío rechazado conserva lo escrito para corregirlo.
 */
export function EditAssignmentForm({
  action,
  findingId,
  onSaved,
}: {
  action: ActionSummary;
  findingId: string;
  onSaved: () => void;
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

  const replacement = useMutation({
    mutationFn: (request: ReplaceActionAssignmentRequest) => replaceAssignment(action.id, request),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.action(action.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submittedInspection() }),
      ]);
      onSaved();
    },
  });

  /*
    LA MISMA REGLA QUE AL ASIGNAR, y por eso no está escrita acá: editar es reemplazar la
    asignación entera (ADR-020). Con la comprobación copiada, la edición terminaría aceptando
    lo que crear rechaza.
  */
  const submit = (): void => {
    if (replacement.isPending || !roster.isSuccess) return;

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
    replacement.mutate(commitment.request);
  };

  return (
    <form
      className="finding__assignment-editor-form"
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
          disabled={!roster.isSuccess || replacement.isPending}
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
        <span>Describe the corrective action</span>
        <textarea
          value={description}
          minLength={ACTION_DESCRIPTION_MIN}
          maxLength={ACTION_DESCRIPTION_MAX}
          disabled={replacement.isPending}
          aria-invalid={validationError?.startsWith('Description') || undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="finding__step-field">
        <span>Deadline</span>
        <input
          type="datetime-local"
          value={dueAt}
          disabled={replacement.isPending}
          aria-invalid={validationError?.toLowerCase().includes('deadline') || undefined}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </label>

      {validationError ? (
        <p role="alert" className="notice notice--warn">
          {validationError}
        </p>
      ) : null}

      {replacement.isError ? (
        <p role="alert" className="notice notice--warn">
          {replacement.error.message || 'The assignment could not be edited.'}
        </p>
      ) : null}

      <div className="finding__create-actions">
        <button
          className="button--primary"
          type="submit"
          disabled={!roster.isSuccess || replacement.isPending}
        >
          {replacement.isPending ? 'Saving…' : 'Save assignment'}
        </button>
      </div>
    </form>
  );
}
