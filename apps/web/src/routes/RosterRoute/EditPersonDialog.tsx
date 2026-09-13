import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { correctAccountEmail, updatePerson } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import {
  editPersonButtonText,
  personCorrection,
  type EditPersonState,
  type EditPersonValues,
} from './presentation';

/** Corrige los datos de una persona activa y, si corresponde, el email de su invitación. */
export function EditPersonDialog({
  personId,
  firstName,
  lastName,
  employeeNumber,
  account,
  label,
  siteId,
  onClose,
}: {
  personId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  account: { userId: string; email: string } | null;
  label: string;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const firstNameId = useId();
  const lastNameId = useId();
  const employeeNumberId = useId();
  const emailId = useId();

  const [current, setCurrent] = useState<EditPersonValues>({
    firstName,
    lastName,
    employeeNumber,
    email: account?.email ?? '',
  });

  const initial: EditPersonValues = {
    firstName,
    lastName,
    employeeNumber,
    email: account?.email ?? '',
  };
  const correction = personCorrection(initial, current);
  const hasPersonChanges = Object.keys(correction.person).length > 0;
  const emailChanged = account !== null && correction.emailChanged;
  const hasChanges = hasPersonChanges || emailChanged;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      if (hasPersonChanges) {
        await updatePerson({ personId, ...correction.person });
      }

      if (emailChanged && account !== null) {
        await correctAccountEmail({ userId: account.userId, email: current.email });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      dialogRef.current?.close();
    },
  });

  const state: EditPersonState = save.isPending ? 'pending' : save.isError ? 'error' : 'ready';
  const canSubmit =
    hasChanges &&
    current.firstName.trim() !== '' &&
    current.lastName.trim() !== '' &&
    current.employeeNumber.trim() !== '' &&
    (!account || current.email.trim() !== '');

  const close = (): void => {
    if (state !== 'pending') dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (state === 'pending') event.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId}>Edit {label}</h2>
      <p className="modal__text">Correct this person&apos;s roster details.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && state !== 'pending') save.mutate();
        }}
      >
        <label htmlFor={firstNameId}>First name</label>
        <input
          id={firstNameId}
          type="text"
          value={current.firstName}
          disabled={state === 'pending'}
          onChange={(event) => setCurrent((value) => ({ ...value, firstName: event.target.value }))}
        />

        <label htmlFor={lastNameId}>Last name</label>
        <input
          id={lastNameId}
          type="text"
          value={current.lastName}
          disabled={state === 'pending'}
          onChange={(event) => setCurrent((value) => ({ ...value, lastName: event.target.value }))}
        />

        <label htmlFor={employeeNumberId}>Employee number</label>
        <input
          id={employeeNumberId}
          type="text"
          value={current.employeeNumber}
          disabled={state === 'pending'}
          onChange={(event) =>
            setCurrent((value) => ({ ...value, employeeNumber: event.target.value }))
          }
        />

        {account ? (
          <>
            <label htmlFor={emailId}>Email</label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              value={current.email}
              disabled={state === 'pending'}
              onChange={(event) => setCurrent((value) => ({ ...value, email: event.target.value }))}
            />
          </>
        ) : null}

        {state === 'error' ? (
          <p role="alert" className="notice notice--warn">
            {save.error?.message ?? 'This person could not be updated.'}
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="submit" disabled={!canSubmit || state === 'pending'}>
            {editPersonButtonText(state)}
          </button>
          <button type="button" onClick={close} disabled={state === 'pending'}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
