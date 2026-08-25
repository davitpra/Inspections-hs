import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { setJhscSeat } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';

/**
 * `coordinator-jhsc-seat` — Sienta a una cuenta de coordinador en el JHSC, o la levanta.
 *
 * **NO ES UNA ACCIÓN SOBRE EL ACCESO, y el diálogo tiene que decirlo.** Vive al lado de
 * `RemoveAccessDialog` y se parece, pero lo que hace es lo contrario de destructivo: la
 * cuenta entra igual antes y después, con la misma credencial y la misma sesión. Lo único
 * que cambia es si la consola de programación la ofrece como inspectora. Sin esa frase, un
 * modal de confirmación en la misma columna que "Remove" se lee como si quitara algo.
 *
 * **Al levantar, dice qué NO pasa.** Las inspecciones ya asignadas siguen siendo suyas y
 * siguen en sus pendientes: el asiento gobierna lo que se ofrece de acá en más, no lo que
 * ya se decidió. Es exactamente lo que alguien podría creer que este botón resuelve —"se
 * fue del comité, que se reasignen sus inspecciones"— y creerlo dejaría inspecciones
 * esperando a quien nadie va a buscar.
 *
 * **Confirma igual, aunque no sea destructivo**, porque casi siempre se aprieta sobre la
 * fila propia y el efecto no se ve en esta pantalla sino en otra: quien se sienta aparece
 * como candidata en programación, y quien se levanta deja de aparecer.
 *
 * Vive fuera de la fila (ver `index.tsx`): la mutación invalida el roster y la celda que lo
 * abrió se vuelve a dibujar con el otro botón.
 */
export function JhscSeatDialog({
  userId,
  personLabel,
  action,
  siteId,
  onClose,
}: {
  userId: string;
  personLabel: string;
  action: 'grant' | 'withdraw';
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const granting = action === 'grant';

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const seat = useMutation({
    mutationFn: () => setJhscSeat({ userId, granted: granting }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(userId) });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <h2>
        {granting
          ? `Seat ${personLabel} on the JHSC?`
          : `Remove ${personLabel} from the JHSC seat?`}
      </h2>

      <p>
        {granting
          ? 'They can be assigned inspections at the sites they already have access to. Nothing else about their account changes.'
          : 'They stop being offered for new inspections. Inspections already assigned to them stay assigned and still appear in what they owe.'}
      </p>

      <button type="button" onClick={() => seat.mutate()} disabled={seat.isPending}>
        {seat.isPending ? 'Saving…' : granting ? 'Seat on the JHSC' : 'Remove from the seat'}
      </button>

      {seat.isError ? <p className="notice">{(seat.error as Error).message}</p> : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Cancel
      </button>
    </dialog>
  );
}
