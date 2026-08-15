import { pendingInspectionSchema, type PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { sessionClient } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { InstallPrompt } from '../../app/InstallPrompt';
import { useAppSession } from '../../app/session-context';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { listDrafts } from '../../offline/drafts';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { DraftRow } from './DraftRow';
import { PendingRow } from './PendingRow';

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

  /**
   * El borrador que se está por descartar, ACÁ y no en la fila: descartar invalida la
   * lista y la fila que abrió el diálogo desaparece del próximo render. El modal
   * sobrevive porque cuelga de la ruta, que no se va. Mismo criterio que los diálogos
   * del roster.
   */
  const [discarding, setDiscarding] = useState<DraftRowData | null>(null);

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
          <DraftRow
            key={draft.client_submission_id}
            draft={draft}
            onDiscard={setDiscarding}
          />
        ))}
      </ul>

      {discarding && account ? (
        <DiscardDraftDialog
          clientSubmissionId={discarding.client_submission_id}
          accountId={account.userId}
          startedOn={discarding.created_at.slice(0, 10)}
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}
