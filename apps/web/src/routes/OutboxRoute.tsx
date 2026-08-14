import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../api/query-keys';
import { useAppSession } from '../app/session-context';
import { UnsyncedIndicator } from '../components/UnsyncedIndicator';
import { db } from '../offline/db';
import { runOutbox } from '../offline/outbox';

/**
 * La cola de salida, a la vista.
 *
 * Existe porque una entrada rechazada tiene que ser visible con el motivo del servidor:
 * el requisito dice que un envío rechazado se conserva y se muestra, no que se
 * descarta. Sin esta pantalla, "se conserva" sería un detalle de implementación que
 * nadie puede comprobar.
 */
export function OutboxRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const queryClient = useQueryClient();

  const entries = useQuery({
    queryKey: queryKeys.outbox(),
    queryFn: async () => {
      const rows = await db.outbox.toArray();

      return Promise.all(
        rows.map(async (row) => ({
          row,
          draft: await db.drafts.get(row.client_submission_id),
        })),
      );
    },
    refetchInterval: 5_000,
  });

  const send = useMutation({
    mutationFn: () => runOutbox(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.outbox() }),
  });

  const rows = entries.data ?? [];

  return (
    <>
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <h1>Waiting to be sent</h1>

      {rows.length === 0 ? (
        <p>Nothing is waiting. Everything on this device has been accepted by the server.</p>
      ) : null}

      <ul className="list">
        {rows.map(({ row, draft }) => (
          <li key={row.client_submission_id} className="list__row">
            <p>
              {row.state === 'rejected' ? 'Rejected by the server' : 'Queued'} — {row.attempts}{' '}
              attempt{row.attempts === 1 ? '' : 's'}
            </p>

            {row.last_error ? <p className="notice notice--warn">{row.last_error}</p> : null}

            {draft ? (
              // El borrador sigue legible en el dispositivo, incluso rechazado. Es
              // trabajo que hay que arreglar, no trabajo que se tira.
              <Link to="/inspections/$id/capture" params={{ id: draft.scheduled_inspection_id }}>
                Open the inspection
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => send.mutate()} disabled={send.isPending}>
        {send.isPending ? 'Sending…' : 'Try again now'}
      </button>
    </>
  );
}
