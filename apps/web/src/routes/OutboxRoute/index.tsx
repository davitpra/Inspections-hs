import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { DiscardInspectionDraftDialog } from '../../components/DiscardInspectionDraftDialog';
import { StatsBar } from '../../components/StatsBar';
import { UnsyncedIndicator } from '../../components/UnsyncedIndicator';
import { CheckIcon, ClipboardIcon, ClockIcon, InfoIcon } from '../../components/icons';
import type { DraftRow } from '../../offline/db';
import { deviceWork, runOutbox } from '../../offline/outbox';
import { WorkRow } from './WorkRow';
import { byUrgency, tally } from './presentation';

/**
 * Lo que no salió de este dispositivo, a la vista.
 *
 * Existe por dos requisitos, y el segundo es el que le da la forma que tiene:
 *
 * 1. Una entrada rechazada tiene que ser visible con el motivo del servidor: el requisito
 *    dice que un envío rechazado se conserva y se muestra, no que se descarta. Sin esta
 *    pantalla, "se conserva" sería un detalle de implementación que nadie puede comprobar.
 * 2. **Lista EL MISMO CONJUNTO que cuenta el indicador de ADR-010** —`listUnsent`, vía
 *    `deviceWork`— y no solo las entradas de la cola. El indicador no se puede descartar a
 *    propósito, para que el supuesto de los 7 días sea verificable por el inspector; un
 *    aviso permanente sobre trabajo que ninguna pantalla muestra es lo contrario de
 *    verificable. Y eso pasaba: un borrador sin firmar no tiene fila de cola, y las dos
 *    pantallas que listaban borradores los colgaban de la inspección pendiente que
 *    devuelve el servidor, que deja de traerla si se cancela, se reasigna o desaparece.
 *
 * Por eso el encabezado dice "on this device" y no "waiting to be sent": desde que la
 * lista incluye lo que todavía no se firmó, "esperando red" sería falso para una parte de
 * lo que se ve. Son las palabras que el propio indicador ya usa.
 *
 * Se dibuja con el mismo vocabulario que el resto de la consola —encabezado con ícono,
 * `.stats-bar`, `.card`, `.status-pill`— y no como una pantalla de error, por la misma
 * razón que `OfflineRoute`: acá no hay nada roto. Una entrada en cola es trabajo firmado
 * que está esperando red, y el rojo invita a maniobras que pueden perderlo (ADR-001).
 */
export function OutboxRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const queryClient = useQueryClient();
  const [discarding, setDiscarding] = useState<DraftRow | null>(null);

  // Solo el trabajo de esta cuenta. Lo que otra cuenta dejó sin enviar en este dispositivo
  // no es información de esta —el mismo criterio que la lista de borradores— y además
  // no se puede enviar desde acá: el servidor toma el firmante de la sesión.
  const entries = useQuery({
    queryKey: queryKeys.outbox(account?.userId),
    enabled: Boolean(account),
    queryFn: async () => (account ? deviceWork(account.userId) : []),
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
            <h1>On this device</h1>
          </div>
          <p className="scheduling__subtitle">
            Work stays on this device until the server accepts it.
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
                Everything you started on this device has been accepted by the server.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/*
            Los tres números que cambian qué hace el inspector: lo que espera red se
            resuelve solo, lo rechazado hay que abrirlo, y lo sin firmar es un recorrido
            que sigue siendo suyo. La tira se lee antes que las filas porque con varias
            entradas acumuladas es lo que dice si hay algo que hacer ahora o solo hay que
            reconectar.
          */}
          <StatsBar
            items={[
              { icon: <ClockIcon size={18} />, number: counts.queued, label: 'Waiting to send' },
              {
                icon: <InfoIcon size={18} />,
                number: counts.rejected,
                label: 'Rejected by the server',
              },
              {
                icon: <ClipboardIcon size={18} />,
                number: counts.unsigned,
                label: 'Not signed yet',
              },
            ]}
            tip="Nothing here has left this device. Sending happens on its own when there is a connection."
          />

          <div className="card">
            <div className="card__head">
              <h3>On this device</h3>
            </div>

            <ul className="list outbox__list">
              {rows.map((entry) => (
                <WorkRow
                  key={entry.draft.client_submission_id}
                  entry={entry}
                  onDiscard={setDiscarding}
                />
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

      {discarding && account ? (
        <DiscardInspectionDraftDialog
          clientSubmissionId={discarding.client_submission_id}
          scheduledInspectionId={discarding.scheduled_inspection_id}
          accountId={account.userId}
          startedOn={discarding.created_at.slice(0, 10)}
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}
