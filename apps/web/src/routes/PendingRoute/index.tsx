import { pendingInspectionSchema, type PendingInspection } from '@hs/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { sessionClient } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { InstallPrompt } from '../../app/InstallPrompt';
import { useAppSession } from '../../app/session-context';
import { CalendarIcon, GridIcon, ListIcon } from '../../components/icons';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { listDrafts } from '../../offline/drafts';
import { missingForField } from '../../offline/prefetch';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { DraftRow } from './DraftRow';
import { PendingRow } from './PendingRow';
import {
  draftPeriodStart,
  earliestPendingYear,
  initialYear,
  pendingOfYear,
  pendingStats,
  pendingWork,
  readiness,
  submittedFromDevice,
} from './presentation';

/**
 * La pantalla de inicio del miembro del JHSC: lo que todavía debe, si cada cosa está
 * lista para el campo, y la acción que corresponde.
 *
 * El estado de "lista para el campo" se muestra ACÁ, con red todavía disponible, porque
 * es el único momento en que se puede arreglar. Descubrirlo en la planta es descubrirlo
 * tarde. Y se arregla ACÁ también: la tarjeta que dice que falta el roster es la misma que
 * lo baja.
 *
 * SE LEE COMO EL CALENDARIO DEL COORDINADOR, y no es decoración: los dos hojean la misma
 * obligación mensual. El mes es lo que la identifica, así que es lo primero de cada
 * tarjeta, y el año se navega con las mismas flechas.
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

  const [view, setView] = useState<'grid' | 'list'>('grid');

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

  const all = pending.data ?? [];

  /**
   * `null` hasta que la lista llega, y entonces el año que corresponda: `initialYear`
   * necesita los pendientes para no abrir en un año vacío, y en el primer render todavía
   * no están.
   */
  const [chosenYear, setChosenYear] = useState<string | null>(null);
  const year = chosenYear ?? initialYear(all);

  const entries = pendingOfYear(all, year);
  const earliestYear = earliestPendingYear(all, year);
  const canGoBack = year > earliestYear;

  /**
   * El estado del paquete de las tarjetas visibles, para el pie. Cada tarjeta ya lo
   * consulta por su cuenta y con la MISMA clave, así que esto no agrega una sola llamada:
   * es la misma consulta leída dos veces.
   */
  const readinessOf = useQueries({
    queries: entries.map((inspection) => ({
      queryKey: queryKeys.fieldReady(inspection.id),
      queryFn: () => missingForField(inspection.id),
    })),
  });

  const stats = pendingStats(
    entries.map((inspection, index) => ({
      overdue: inspection.overdue,
      state: readiness(readinessOf[index]?.data),
    })),
  );

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
            <h1>Inspections due</h1>
          </div>
          <p className="scheduling__subtitle">
            Download each inspection while you have a connection, then walk the site.
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

      <div className="calendar-toolbar">
        <div className="year-nav">
          <button
            type="button"
            className="year-nav__arrow"
            disabled={!canGoBack}
            onClick={() => setChosenYear(String(Number(year) - 1))}
          >
            ← {Number(year) - 1}
          </button>

          <div className="year-nav__current">
            <CalendarIcon size={18} />
            <h2>{year}</h2>
          </div>

          <button
            type="button"
            className="year-nav__arrow"
            onClick={() => setChosenYear(String(Number(year) + 1))}
          >
            {Number(year) + 1} →
          </button>
        </div>

        <div className="view-toggle">
          <button
            type="button"
            className="view-toggle__button"
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <GridIcon size={16} /> Grid view
          </button>
          <button
            type="button"
            className="view-toggle__button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <ListIcon size={16} /> List view
          </button>
        </div>
      </div>

      {pending.isSuccess && entries.length === 0 ? (
        <p>Nothing is due in {year}.</p>
      ) : null}

      <ul className={view === 'grid' ? 'grid grid--scheduling' : 'grid--list'}>
        {entries.map((inspection) => (
          <PendingRow key={inspection.id} inspection={inspection} />
        ))}
      </ul>

      <div className="stats-bar">
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.total}</span>
            <span className="stats-bar__label">Due in {year}</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.ready}</span>
            <span className="stats-bar__label">Ready for the field</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.notReady}</span>
            <span className="stats-bar__label">Need downloading</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.overdue}</span>
            <span className="stats-bar__label">Overdue</span>
          </span>
        </div>

        {/*
          El número de "Need downloading" es el único que caduca: se arregla con red y no
          se puede arreglar sin ella. El pie es donde se mira ese número, así que es donde
          tiene que estar la consecuencia.
        */}
        <p className="stats-bar__tip">
          Tip: download an inspection before you lose the connection — the site walk works
          offline, the download does not.
        </p>
      </div>

      {/*
        Los borradores del dispositivo NO se filtran por año. No guardan el período —el mes
        se resuelve contra la lista de arriba y muchas veces no se puede—, así que un
        filtro escondería trabajo real sin que se entienda por qué.
      */}
      <h2>Drafts on this device</h2>

      {working.length === 0 ? <p>No drafts in progress on this device.</p> : null}

      <ul className={view === 'grid' ? 'grid grid--scheduling' : 'grid--list'}>
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

          <ul className={view === 'grid' ? 'grid grid--scheduling' : 'grid--list'}>
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
