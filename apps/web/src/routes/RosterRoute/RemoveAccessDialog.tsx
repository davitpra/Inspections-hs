import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { removeJhscAccess } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';

/**
 * `remove-jhsc-access-from-roster` — Quita el acceso al JHSC: cancela la invitación que
 * nadie aceptó, o saca del comité a quien ya entra todos los días.
 *
 * **Un diálogo, dos preguntas distintas.** La escritura del otro lado es una sola —la
 * cuenta queda inactiva—, pero lo que el coordinador está a punto de hacer no se siente
 * igual en los dos casos, y la confirmación tiene que decir la verdad de cada uno:
 * cancelar una invitación deja sin uso un link que puede estar en el correo de alguien;
 * quitar a un miembro lo saca de la sesión que quizá tiene abierta ahora mismo. Por eso
 * `canSignIn` cambia el texto y no hay dos componentes: la diferencia es de redacción, y
 * partirla en dos archivos dejaría dos confirmaciones que hay que mantener iguales en todo
 * lo demás.
 *
 * **Confirma, y por eso existe.** Es una acción destructiva sobre el acceso de otra
 * persona colgada de una fila entre doscientas; un botón que la ejecutara de una es un
 * error de puntería a un clic de distancia.
 *
 * No devuelve token y no muestra ninguno: no hay nada que copiar. Se cierra solo al
 * terminar — a diferencia de invitar o reemitir, acá no queda nada en pantalla que el
 * coordinador tenga que leer antes de que el modal se vaya.
 *
 * Vive fuera de la fila (ver `index.tsx`): la mutación invalida el roster y la celda que
 * lo abrió se vuelve a dibujar sin el botón.
 */
export function RemoveAccessDialog({
  userId,
  personLabel,
  canSignIn,
  siteId,
  onClose,
}: {
  userId: string;
  personLabel: string;
  canSignIn: boolean;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const remove = useMutation({
    mutationFn: () => removeJhscAccess({ userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(userId) });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <h2>
        {canSignIn ? `Remove ${personLabel} from the JHSC?` : `Cancel the invitation of ${personLabel}?`}
      </h2>

      <p>
        {canSignIn
          ? 'They lose access immediately and any session they have open ends. They remain listed at this site because losing access is not leaving the company.'
          : 'The invitation link stops working. They remain listed at this site and can be invited again later.'}
      </p>

      <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
        {remove.isPending ? 'Removing…' : canSignIn ? 'Remove from JHSC' : 'Cancel the invitation'}
      </button>

      {remove.isError ? <p className="notice">{(remove.error as Error).message}</p> : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Keep access
      </button>
    </dialog>
  );
}
