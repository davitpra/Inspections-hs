import {
  ACTION_DESCRIPTION_MAX,
  ACTION_DESCRIPTION_MIN,
  createActionRequestSchema,
  type CreateActionRequest,
  type Finding,
} from '@hs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { createAction } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { listPeople } from '../../api/roster';
import { CheckIcon } from '../../components/icons';
import { futureDueAt } from './presentation';

export function CreateActionForm({
  finding,
  onClose,
  returnFocusTo,
}: {
  finding: Finding;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const assigneeId = useId();
  const descriptionId = useId();
  const dueAtId = useId();
  const [assigneePersonId, setAssigneePersonId] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: queryKeys.roster(finding.site_id),
    queryFn: () => listPeople(finding.site_id),
    retry: false,
  });

  useEffect(() => {
    const trigger = returnFocusTo.current;
    dialogRef.current?.showModal();

    return () => trigger?.focus();
  }, [returnFocusTo]);

  const creation = useMutation({
    mutationFn: (request: CreateActionRequest) => createAction(finding.id, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.actions() });
      dialogRef.current?.close();
    },
  });

  const close = (): void => {
    if (!creation.isPending) dialogRef.current?.close();
  };

  const submit = (): void => {
    if (creation.isPending || !roster.isSuccess) return;

    if (!roster.data.some((person) => person.id === assigneePersonId)) {
      setValidationError('Choose an active assignee from this site.');
      return;
    }

    const deadline = futureDueAt(dueAt, new Date());
    if (!deadline.success) {
      setValidationError(deadline.message);
      return;
    }

    const request = createActionRequestSchema.safeParse({
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
    creation.mutate(request.data);
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal actions-create-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (creation.isPending) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="actions-create-dialog__head">
        <span className="actions-create-dialog__icon"><CheckIcon size={22} /></span>
        <div>
          <p className="actions-overview__eyebrow">New commitment</p>
          <h2 id={titleId}>Create corrective action</h2>
        </div>
      </div>
      <p className="modal__text actions-create-dialog__finding">
        <span>Finding</span>
        <strong>For: {finding.description}</strong>
      </p>

      <form
        className="modal__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={assigneeId}>Assignee</label>
        <select
          id={assigneeId}
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

        {roster.isError ? (
          <p role="alert" className="notice notice--warn">
            The active people for this site need a connection.
          </p>
        ) : null}

        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          value={description}
          minLength={ACTION_DESCRIPTION_MIN}
          maxLength={ACTION_DESCRIPTION_MAX}
          disabled={creation.isPending}
          aria-invalid={validationError?.startsWith('Description') || undefined}
          onChange={(event) => setDescription(event.target.value)}
        />

        <label htmlFor={dueAtId}>Deadline</label>
        <input
          id={dueAtId}
          type="datetime-local"
          value={dueAt}
          disabled={creation.isPending}
          aria-invalid={validationError?.includes('deadline') || undefined}
          onChange={(event) => setDueAt(event.target.value)}
        />

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

        <div className="modal__actions">
          <button className="button--primary" type="submit" disabled={!roster.isSuccess || creation.isPending}>
            {creation.isPending ? 'Creating…' : 'Create action'}
          </button>
          <button className="button--outline" type="button" onClick={close} disabled={creation.isPending}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
