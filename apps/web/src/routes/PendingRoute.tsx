import { pendingInspectionSchema, type PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { z } from 'zod';

import { sessionClient } from '../api/client';
import { queryKeys } from '../api/query-keys';
import { InstallPrompt } from '../app/InstallPrompt';
import { useAppSession } from '../app/session-context';
import { DownloadForField, readableKind } from '../components/FieldPackage';
import { listDrafts } from '../offline/drafts';
import { missingForField } from '../offline/prefetch';

/**
 * La pantalla de inicio del miembro del JHSC: lo que todavía debe, si cada cosa está
 * lista para el campo, y la acción que corresponde.
 *
 * El estado de "lista para el campo" se muestra ACÁ, con red todavía disponible, porque
 * es el único momento en que se puede arreglar. Descubrirlo en la planta es descubrirlo
 * tarde. Y se arregla ACÁ también: la fila que dice que falta el roster es la misma que
 * lo baja.
 */
export function PendingRoute(): React.JSX.Element {
  const { account } = useAppSession();

  const pending = useQuery({
    queryKey: queryKeys.pendingInspections(),
    queryFn: async (): Promise<PendingInspection[]> => {
      const result = await sessionClient.request<unknown>('/me/pending-inspections');
      if (!result.ok) throw new Error(result.message);

      return z.array(pendingInspectionSchema).parse(result.value);
    },
    // Sin red esto falla, y está bien: la lista es de servidor. Los borradores locales
    // se listan aparte, abajo, y esos sí están siempre.
    retry: false,
  });

  const drafts = useQuery({
    queryKey: queryKeys.drafts(account?.userId),
    queryFn: async () => (account ? listDrafts(account.userId) : []),
    enabled: Boolean(account),
  });

  return (
    <>
      <InstallPrompt />

      <h1>Inspections due</h1>

      {pending.isError ? (
        <p className="notice">
          The list of scheduled inspections needs a connection. Drafts already on this device
          are below and are not affected.
        </p>
      ) : null}

      <ul className="list">
        {(pending.data ?? []).map((inspection) => (
          <PendingRow key={inspection.id} inspection={inspection} />
        ))}
      </ul>

      <h2>Drafts on this device</h2>

      <ul className="list">
        {(drafts.data ?? []).map((draft) => (
          <li key={draft.client_submission_id} className="list__row">
            <Link to="/inspections/$id/capture" params={{ id: draft.scheduled_inspection_id }}>
              {draft.status === 'accepted' ? 'Submitted' : 'Draft'} — started{' '}
              {draft.created_at.slice(0, 10)}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function PendingRow({ inspection }: { inspection: PendingInspection }): React.JSX.Element {
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });

  const ready = missing.data?.length === 0;

  return (
    <li className="list__row">
      <span>
        {inspection.template_name} — {inspection.period_start.slice(0, 7)}
      </span>

      {inspection.overdue ? <span className="badge badge--overdue">Overdue</span> : null}

      {/*
       * Una sola acción por fila, y es la que corresponde al estado: bajar el paquete, o
       * empezar. Mientras la consulta no resolvió no se ofrece ninguna — un botón de
       * empezar que aparece antes de saber si hay documento manda al inspector a una
       * pantalla que lo va a rechazar.
       */}
      {missing.isSuccess ? (
        ready ? (
          <>
            <span className="badge badge--ready">Ready for the field</span>
            <Link
              to="/inspections/$id/capture"
              params={{ id: inspection.id }}
              className="list__action"
            >
              Start inspection
            </Link>
          </>
        ) : (
          <>
            {/*
             * Lo que falta se NOMBRA. Un booleano en rojo no le dice al inspector qué
             * hacer; "roster" sí.
             */}
            <span className="badge badge--missing">
              Not ready — missing {missing.data.map(readableKind).join(', ')}
            </span>
            <DownloadForField id={inspection.id} />
          </>
        )
      ) : null}
    </li>
  );
}
