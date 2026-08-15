import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { UnsyncedIndicator } from '../../components/UnsyncedIndicator';
import { outboxFor, runOutbox } from '../../offline/outbox';

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

  // Solo la cola de esta cuenta. Lo que otra cuenta dejó sin enviar en este dispositivo
  // no es información de esta —el mismo criterio que la lista de borradores— y además
  // no se puede enviar desde acá: el servidor toma el firmante de la sesión.
  const entries = useQuery({
    queryKey: queryKeys.outbox(account?.userId),
    enabled: Boolean(account),
    queryFn: async () => (account ? outboxFor(account.userId) : []),
    refetchInterval: 5_000,
  });

  const send = useMutation({
    mutationFn: () => runOutbox({ accountId: account?.userId ?? null }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.outbox(account?.userId) }),
  });

  const rows = entries.data ?? [];

  return (
    <>
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <h1>Waiting to be sent</h1>

      {rows.length === 0 ? (
        <p>Nothing is waiting. Everything you signed on this device has been accepted.</p>
      ) : null}

      <ul className="list">
        {rows.map(({ row, draft }) => (
          <li key={row.client_submission_id} className="list__row">
            <p>
              {row.state === 'rejected' ? 'Rejected by the server' : 'Queued'} — {row.attempts}{' '}
              attempt{row.attempts === 1 ? '' : 's'}
            </p>

            {row.last_error ? <p className="notice notice--warn">{row.last_error}</p> : null}

            {/*
              El borrador sigue legible en el dispositivo, incluso rechazado. Es trabajo
              que hay que arreglar, no trabajo que se tira. Existe siempre: `outboxFor`
              solo devuelve entradas que tienen el suyo.
            */}
            <Link to="/inspections/$id/capture" params={{ id: draft.scheduled_inspection_id }}>
              Open the inspection
            </Link>
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => send.mutate()} disabled={send.isPending}>
        {send.isPending ? 'Sending…' : 'Try again now'}
      </button>
    </>
  );
}
