import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { createPerson } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { addPersonButtonText, type AddPersonState } from './presentation';

/**
 * El alta de UNA persona (`add-person-to-roster-by-hand`), calcado del patrón de
 * `ImportDialog.tsx`: `showModal()` en `useEffect`, `returnFocusTo` para devolver el foco
 * al disparador, cierre bloqueado mientras la mutación está pendiente.
 *
 * **Tres campos y nada de email ni de cuenta (design D5).** Persona ≠ Usuario: dar acceso
 * es "Invite to JHSC", que la fila recién creada ya ofrece. Encadenar el alta con la
 * invitación desde acá inventaría una transacción que no existe.
 *
 * `siteId`/`siteName` vienen de la pantalla, no de un selector propio: el alta es sobre la
 * planta que el `SitePicker` del encabezado ya muestra (design D6).
 */
export function AddPersonDialog({
  siteId,
  siteName,
  onClose,
  returnFocusTo,
}: {
  siteId: string;
  siteName: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const employeeNumberId = useId();
  const firstNameId = useId();
  const lastNameId = useId();

  const [employeeNumber, setEmployeeNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    const trigger = returnFocusTo.current;
    dialogRef.current?.showModal();

    return () => trigger?.focus();
  }, [returnFocusTo]);

  const addPerson = useMutation({
    mutationFn: () =>
      createPerson({
        site_id: siteId,
        employee_number: employeeNumber,
        first_name: firstName,
        last_name: lastName,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      dialogRef.current?.close();
    },
  });

  const state: AddPersonState = addPerson.isPending
    ? 'pending'
    : addPerson.isError
      ? 'error'
      : 'ready';

  const canSubmit =
    employeeNumber.trim() !== '' && firstName.trim() !== '' && lastName.trim() !== '';

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
      <h2 id={titleId}>Add person</h2>
      <p className="modal__text">Adds one person to the roster of {siteName}.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && state !== 'pending') addPerson.mutate();
        }}
      >
        <label htmlFor={employeeNumberId}>Employee number</label>
        <input
          id={employeeNumberId}
          type="text"
          value={employeeNumber}
          disabled={state === 'pending'}
          onChange={(event) => setEmployeeNumber(event.target.value)}
        />

        <label htmlFor={firstNameId}>First name</label>
        <input
          id={firstNameId}
          type="text"
          value={firstName}
          disabled={state === 'pending'}
          onChange={(event) => setFirstName(event.target.value)}
        />

        <label htmlFor={lastNameId}>Last name</label>
        <input
          id={lastNameId}
          type="text"
          value={lastName}
          disabled={state === 'pending'}
          onChange={(event) => setLastName(event.target.value)}
        />

        {state === 'error' ? (
          <p role="alert" className="notice notice--warn">
            {addPerson.error?.message ?? 'This person could not be added.'}
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="submit" disabled={!canSubmit || state === 'pending'}>
            {addPersonButtonText(state)}
          </button>
          <button type="button" onClick={close} disabled={state === 'pending'}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
