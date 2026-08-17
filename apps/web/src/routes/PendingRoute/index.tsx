import { pendingInspectionSchema, type PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { sessionClient } from '../../api/client';
import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { InstallPrompt } from '../../app/InstallPrompt';
import { useAppSession } from '../../app/session-context';
import { CalendarIcon, InfoIcon, PinIcon } from '../../components/icons';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { listDrafts } from '../../offline/drafts';
import { civilMonth, civilToday, monthName } from '../../presentation/dates';
import { AssignmentChecklist } from './AssignmentChecklist';
import { AssignmentHero } from './AssignmentHero';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { DraftRow } from './DraftRow';
import { NextAssignment } from './NextAssignment';
import { NoAssignment } from './NoAssignment';
import { RecentInspections } from './RecentInspections';
import {
  draftPeriodStart,
  focusedAssignment,
  nextAssignment,
  pendingWork,
  submittedFromDevice,
} from './presentation';

/**
 * La pantalla de inicio del miembro del JHSC: lo que debe ahora, lo que viene después, y
 * lo que ya cerró.
 *
 * La asignación del mes en curso —o la vencida más antigua, si hay una— es el HÉROE de la
 * pantalla: título, acción y datos propios, antes que cualquier otra cosa
 * (`focusedAssignment` decide cuál es). Debajo van las dos preguntas que el inspector tiene
 * a continuación: qué sigue, y qué cerró.
 *
 * **Acá NO hay calendario del año, y su ausencia es una decisión.** La tenía, copiada de la
 * consola del coordinador, y el inspector no planifica un año: trabaja una asignación por
 * vez (ADR-001). El año se planifica en `/scheduling`, que conserva su calendario.
 *
 * El estado de "lista para el campo" se muestra ACÁ, con red todavía disponible, porque
 * es el único momento en que se puede arreglar. Descubrirlo en la planta es descubrirlo
 * tarde. Y se arregla ACÁ también: la tarjeta que dice que falta el roster es la misma que
 * lo baja.
 */
export function PendingRoute(): React.JSX.Element {
  const { account } = useAppSession();

  /**
   * El acuse de la firma anterior, si viene de ahí. Se muestra ACÁ —y no en el outbox—
   * porque una inspección aceptada no está esperando nada: la lista de la que salió es
   * el lugar donde su ausencia se entiende.
   */
  const { submitted } = useSearch({ from: '/' });

  /**
   * El borrador que se está por descartar, ACÁ y no en la tarjeta: descartar invalida la
   * lista y la tarjeta que abrió el diálogo desaparece del próximo render. El modal
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

  /**
   * Sitios y programación completa: solo para la asignación destacada y su columna de
   * preparación (nombre de sitio, historial reciente). De lectura — un miembro del JHSC
   * viendo la programación de su planta es legítimo (ver `router.tsx`).
   */
  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const all = pending.data ?? [];
  const now = new Date();

  const focused = focusedAssignment(all, now);
  const focusedDraft = focused
    ? (drafts.data?.find((draft) => draft.scheduled_inspection_id === focused.id) ?? null)
    : null;
  const focusedSite = focused
    ? sites.data?.find((site) => site.id === focused.site_id)
    : undefined;

  /**
   * Lo que sigue después de lo destacado. Se calcula igual haya o no asignación en curso:
   * la tarjeta es la misma en los dos estados, y por eso la compone la ruta y no cada
   * rama.
   */
  const next = nextAssignment(all, now);

  const working = pendingWork(drafts.data ?? []);
  const sent = submittedFromDevice(drafts.data ?? []);

  return (
    <>
      <InstallPrompt />

      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CalendarIcon size={22} />
            </span>
            <h1>My inspections</h1>
          </div>
          <p className="scheduling__subtitle">
            View and complete workplace inspections assigned to you.
          </p>
        </div>
      </header>

      {submitted === 'accepted' ? (
        <p className="notice">
          Your signed inspection was sent and accepted. It is no longer waiting on this device.
        </p>
      ) : null}

      {pending.isError ? (
        <p className="notice">
          The list of scheduled inspections needs a connection. Drafts already on this device
          are below and are not affected.
        </p>
      ) : null}

      {account && pending.isSuccess ? (
        focused ? (
          <>
            <AssignmentHero
              inspection={focused}
              site={focusedSite}
              account={account}
              draftStatus={focusedDraft?.status ?? null}
              today={civilToday(now)}
            />

            <div className="assignment__layout">
              <div>
                <AssignmentChecklist inspection={focused} draft={focusedDraft} />
              </div>

              <aside className="assignment__aside">
                <div className="card">
                  <h3>
                    <InfoIcon size={18} /> Before you begin
                  </h3>
                  <ul className="checklist">
                    <li>Review the inspection instructions.</li>
                    <li>Be on site and walk all areas.</li>
                    <li>Take photos of any issues.</li>
                    <li>Save your progress as you go.</li>
                    <li>Submit by the due date.</li>
                  </ul>
                </div>

                <div className="card">
                  <h3>
                    <PinIcon size={18} /> Site information
                  </h3>
                  <p className="progress__text">{focusedSite?.name ?? '—'}</p>
                </div>

              </aside>
            </div>
          </>
        ) : (
          <NoAssignment
            currentSiteId={account.siteScope[0] ?? ''}
            monthLabel={`${monthName(`${civilMonth(now)}-01`)} ${civilMonth(now).slice(0, 4)}`}
            siteName={siteName}
          />
        )
      ) : null}

      {/*
        Las dos preguntas que siguen a "¿qué debo ahora?": qué viene después, y qué cerré.
        Van fuera del ternario de arriba porque no dependen de él — se leen igual con
        asignación en curso que sin ella.
      */}
      {account && next ? (
        <NextAssignment inspection={next} account={account} siteName={siteName} />
      ) : null}

      {account ? (
        <RecentInspections
          scheduled={scheduled.data ?? []}
          userId={account.userId}
          siteName={siteName}
        />
      ) : null}

      {/*
        Los borradores del dispositivo NO se filtran por año. No guardan el período —el mes
        se resuelve contra la lista de arriba y muchas veces no se puede—, así que un
        filtro escondería trabajo real sin que se entienda por qué.
      */}
      <h2>Drafts on this device</h2>

      {working.length === 0 ? <p>No drafts in progress on this device.</p> : null}

      <ul className="grid--list">
        {working.map((draft) => (
          <DraftRow
            key={draft.client_submission_id}
            draft={draft}
            periodStart={draftPeriodStart(draft, all)}
            onDiscard={setDiscarding}
          />
        ))}
      </ul>

      {/*
        Lo ya enviado, aparte y después: no espera nada y no se puede tocar. Sigue en la
        pantalla porque abrirlo de solo lectura es el único acceso del inspector a lo que
        mandó cuando no hay red.
      */}
      {sent.length > 0 ? (
        <>
          <h2>Submitted from this device</h2>

          <ul className="grid--list">
            {sent.map((draft) => (
              <DraftRow
                key={draft.client_submission_id}
                draft={draft}
                periodStart={draftPeriodStart(draft, all)}
                onDiscard={setDiscarding}
              />
            ))}
          </ul>
        </>
      ) : null}

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
