import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { StatsBar } from '../../components/StatsBar';
import { UnsyncedIndicator } from '../../components/UnsyncedIndicator';
import { CheckIcon, ClockIcon, InfoIcon } from '../../components/icons';
import { outboxFor, runOutbox } from '../../offline/outbox';
import { formatCivilDay } from '../../presentation/dates';
import {
  attemptsLabel,
  byUrgency,
  statePillClass,
  stateLabel,
  tally,
} from './presentation';

/**
 * La cola de salida, a la vista.
 *
 * Existe porque una entrada rechazada tiene que ser visible con el motivo del servidor:
 * el requisito dice que un envío rechazado se conserva y se muestra, no que se
 * descarta. Sin esta pantalla, "se conserva" sería un detalle de implementación que
 * nadie puede comprobar.
 *
 * Se dibuja con el mismo vocabulario que el resto de la consola —encabezado con ícono,
 * `.stats-bar`, `.card`, `.status-pill`— y no como una pantalla de error, por la misma
 * razón que `OfflineRoute`: acá no hay nada roto. Una entrada en cola es trabajo firmado
 * que está esperando red, y el rojo invita a maniobras que pueden perderlo (ADR-001).
 *
 * Cada fila se lee de arriba abajo (`.list__row--stacked`): el estado, cuándo se empezó,
 * el motivo del servidor si lo hay, y la salida. En fila las tres cosas se mezclan en un
 * párrafo, y el motivo del rechazo es justo lo que hay que poder leer de un vistazo con
 * el teléfono en una mano.
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

  const rows = byUrgency(entries.data ?? []);
  const counts = tally(rows);

  return (
    <>
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <ClockIcon size={22} />
            </span>
            <h1>Waiting to be sent</h1>
          </div>
          <p className="scheduling__subtitle">
            Signed inspections stay on this device until the server accepts them.
          </p>
        </div>
      </header>

      {/*
        El estado vacío es una BUENA noticia y se dibuja como tal, con el mismo aviso
        verde que tranquiliza en la pantalla sin conexión. Una lista vacía sin nada que
        decir deja al inspector preguntándose si su trabajo llegó o si se perdió.
      */}
      {rows.length === 0 ? (
        <div className="notice-card">
          <div className="notice-card__body">
            <span className="notice-card__icon">
              <CheckIcon size={28} />
            </span>
            <div>
              <p className="notice-card__title">Nothing is waiting</p>
              <p className="notice-card__text">
                Everything you signed on this device has been accepted by the server.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/*
            Los dos números que cambian qué hace el inspector: lo que espera red se
            resuelve solo, lo rechazado hay que abrirlo. La tira se lee antes que las
            filas porque con varias entradas acumuladas es lo que dice si hay algo que
            hacer ahora o solo hay que reconectar.
          */}
          <StatsBar
            items={[
              { icon: <ClockIcon size={18} />, number: counts.queued, label: 'Waiting to send' },
              {
                icon: <InfoIcon size={18} />,
                number: counts.rejected,
                label: 'Rejected by the server',
              },
            ]}
            tip="Nothing here has left this device. Sending happens on its own when there is a connection."
          />

          <div className="card">
            <div className="card__head">
              <h3>On this device</h3>
            </div>

            <ul className="list outbox__list">
              {rows.map(({ row, draft }) => (
                <li key={row.client_submission_id} className="list__row list__row--stacked">
                  <p className="outbox__row-head">
                    <span className={statePillClass(row.state)}>{stateLabel(row.state)}</span>
                    <span className="list__aside">{attemptsLabel(row.attempts)}</span>
                  </p>

                  <p className="list__aside">
                    Signed work started {formatCivilDay(draft.created_at)}
                  </p>

                  {row.last_error ? <p className="notice notice--warn">{row.last_error}</p> : null}

                  {/*
                    El borrador sigue legible en el dispositivo, incluso rechazado. Es trabajo
                    que hay que arreglar, no trabajo que se tira. Existe siempre: `outboxFor`
                    solo devuelve entradas que tienen el suyo.
                  */}
                  <Link
                    to="/inspections/$id/capture"
                    params={{ id: draft.scheduled_inspection_id }}
                    className="list__action"
                  >
                    Open the inspection
                  </Link>
                </li>
              ))}
            </ul>

            {/*
              Reintentar es la acción de la LISTA, no de una fila: `runOutbox` corre la cola
              entera. Va al pie de la tarjeta y marcada sin relleno macizo, porque no es el
              paso que hay que dar —la cola se envía sola cuando vuelve la red— sino el
              atajo para no esperar el próximo intento.
            */}
            <div className="card__footer">
              <button
                type="button"
                className="button--outline outbox__retry"
                onClick={() => send.mutate()}
                disabled={send.isPending}
              >
                {send.isPending ? 'Sending…' : 'Try again now'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
