import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { correctAccountEmail, updatePerson } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
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
  const emailHintId = useId();

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
      className="modal edit-person-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (state === 'pending') event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="edit-person-dialog__head">
        <span className="edit-person-dialog__icon" aria-hidden="true">
          <PersonIcon size={24} />
        </span>
        <div>
          <p className="edit-person-dialog__eyebrow">Roster</p>
          <h2 id={titleId}>Edit {label}</h2>
        </div>
      </div>

      <p className="edit-person-dialog__intro">Correct this person&apos;s roster details.</p>

      <form
        className="edit-person-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && state !== 'pending') save.mutate();
        }}
      >
        <div className="edit-person-dialog__names">
          <div className="edit-person-dialog__field">
            <label htmlFor={firstNameId}>First name</label>
            <input
              id={firstNameId}
              type="text"
              autoComplete="off"
              value={current.firstName}
              disabled={state === 'pending'}
              onChange={(event) =>
                setCurrent((value) => ({ ...value, firstName: event.target.value }))
              }
            />
          </div>

          <div className="edit-person-dialog__field">
            <label htmlFor={lastNameId}>Last name</label>
            <input
              id={lastNameId}
              type="text"
              autoComplete="off"
              value={current.lastName}
              disabled={state === 'pending'}
              onChange={(event) =>
                setCurrent((value) => ({ ...value, lastName: event.target.value }))
              }
            />
          </div>
        </div>

        <div className="edit-person-dialog__field">
          <label htmlFor={employeeNumberId}>Employee number</label>
          <input
            id={employeeNumberId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={current.employeeNumber}
            disabled={state === 'pending'}
            onChange={(event) =>
              setCurrent((value) => ({ ...value, employeeNumber: event.target.value }))
            }
          />
        </div>

        {account ? (
          <div className="edit-person-dialog__field edit-person-dialog__field--account">
            <label htmlFor={emailId}>Email</label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              aria-describedby={emailHintId}
              value={current.email}
              disabled={state === 'pending'}
              onChange={(event) => setCurrent((value) => ({ ...value, email: event.target.value }))}
            />
            <p id={emailHintId} className="edit-person-dialog__hint">
              Corrects the pending invitation. No new link is issued.
            </p>
          </div>
        ) : null}

        {state === 'error' ? (
          <p role="alert" className="notice notice--warn">
            {save.error?.message ?? 'This person could not be updated.'}
          </p>
        ) : null}

        <div className="edit-person-dialog__actions">
          <button type="button" onClick={close} disabled={state === 'pending'}>
            Cancel
          </button>
          <button
            type="submit"
            className="button--primary"
            disabled={!canSubmit || state === 'pending'}
          >
            {editPersonButtonText(state)}
          </button>
        </div>
      </form>
    </dialog>
  );
}
