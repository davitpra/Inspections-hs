import { pendingInspectionSchema, type PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { z } from 'zod';

import { sessionClient } from '../api/client';
import { InstallPrompt } from '../app/InstallPrompt';
import { useAppSession } from '../app/session-context';
import { listDrafts } from '../offline/drafts';
import { missingForField } from '../offline/prefetch';

/**
 * La pantalla de inicio del miembro del JHSC: lo que todavía debe, y —lo que este
 * change agrega— si cada cosa está lista para el campo.
 *
 * El estado de "lista para el campo" se muestra ACÁ, con red todavía disponible, porque
 * es el único momento en que se puede arreglar. Descubrirlo en la planta es descubrirlo
 * tarde.
 */
export function PendingRoute(): React.JSX.Element {
  const { account } = useAppSession();

  const pending = useQuery({
    queryKey: ['pending-inspections'],
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
    queryKey: ['drafts', account?.userId],
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
    queryKey: ['field-ready', inspection.id],
    queryFn: () => missingForField(inspection.id),
  });

  const ready = missing.data?.length === 0;

  return (
    <li className="list__row">
      <Link to="/inspections/$id/prepare" params={{ id: inspection.id }}>
        {inspection.template_name} — {inspection.period_start.slice(0, 7)}
      </Link>

      {inspection.overdue ? <span className="badge badge--overdue">Overdue</span> : null}

      {missing.isSuccess ? (
        ready ? (
          <span className="badge badge--ready">Ready for the field</span>
        ) : (
          // Lo que falta se NOMBRA. Un booleano en rojo no le dice al inspector qué
          // hacer; "roster" sí.
          <span className="badge badge--missing">
            Not ready — missing {missing.data.map(readableKind).join(', ')}
          </span>
        )
      ) : null}
    </li>
  );
}

export function readableKind(kind: string): string {
  switch (kind) {
    case 'template_version':
      return 'the inspection form';
    case 'locations':
      return 'the location list';
    case 'roster':
      return 'the roster';
    default:
      return kind;
  }
}
