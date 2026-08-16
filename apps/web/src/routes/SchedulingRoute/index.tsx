import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listScheduled, listSchedules, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { canAdministerScheduling } from '../../permissions/session';
import { CalendarIcon, InfoIcon, PinIcon } from '../../components/icons';
import { PeriodsSection } from './PeriodsSection';
import { currentCivilYear } from '../../presentation/dates';
import { isUnassigned, unassignedNotice } from './presentation';
import { RulesSection } from './RulesSection';

/**
 * §4 — La consola de programación: qué debe esta planta y quién lo está haciendo.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. La obligación mensual la abre un trabajo automático, y
 * cuando la regla no tiene inspector por defecto —que es como la deja el seed, a
 * propósito— la inspección nace con `inspector_id` nulo. `GET /me/pending-inspections`
 * filtra por inspector, así que esa inspección **no está en la lista de nadie**. El
 * coordinador recibe la notificación de que el período se abrió y, hasta acá, no tenía
 * dónde asignarla. Ese era el único eslabón de R1 que se resolvía con curl.
 *
 * UNA PANTALLA Y NO DOS. Las reglas y los períodos que esas reglas abrieron son la misma
 * pregunta; separarlas obligaría a llevar un UUID de una pantalla a la otra.
 *
 * **Administrar es del coordinador.** Los controles no aparecen para nadie más; el
 * servidor los rechaza igual, y esa duplicación es deliberada: la comprobación del
 * cliente evita ofrecer algo que va a fallar, y la del servidor es la que manda. Leer, en
 * cambio, queda abierto — un miembro del JHSC viendo la programación de su planta es
 * legítimo, y RLS ya recorta lo que puede ver.
 */
export function SchedulingRoute(): React.JSX.Element {
  const { account } = useAppSession();

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [year, setYear] = useState(() => currentCivilYear());

  const siteId = chosenSite ?? account?.siteScope[0] ?? '';

  const schedules = useQuery({
    queryKey: queryKeys.inspectionSchedules(),
    queryFn: listSchedules,
    retry: false,
  });

  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });

  const canAdminister = canAdministerScheduling(account);

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const rules = (schedules.data ?? []).filter((rule) => rule.site_id === siteId);
  const periods = (scheduled.data ?? []).filter((entry) => entry.site_id === siteId);
  const notice = unassignedNotice(periods);
  const firstUnassigned = periods.find(isUnassigned);

  return (
    <>
      {/*
        El título a la izquierda y la planta a la derecha, en la misma línea: la planta no
        es un filtro más de la pantalla, es de qué planta habla TODO lo que sigue.
      */}
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CalendarIcon size={22} />
            </span>
            <h1>Scheduling</h1>
          </div>
          <p className="scheduling__subtitle">
            Assign an inspector to each month to ensure inspections are completed on time.
          </p>
        </div>

        <div className="site-card">
          <span className="site-card__icon">
            <PinIcon />
          </span>
          <SitePicker
            sites={sites.data ?? []}
            value={siteId}
            onChange={setChosenSite}
            siteName={siteName}
          />
        </div>
      </header>

      {/*
        El estado de la conexión se lee dentro de la misma pila de tarjetas que todo lo
        demás, así que tiene la silueta de una tarjeta y no la del `.notice` suelto del
        resto de la app — que es global y lo dibujan otras cinco rutas.
      */}
      {schedules.isError || scheduled.isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {schedules.isLoading || scheduled.isLoading ? (
        <p className="status-card">
          <CalendarIcon size={20} /> Loading…
        </p>
      ) : null}

      {notice ? (
        <div className="notice-card">
          <div className="notice-card__body">
            <span className="notice-card__icon">
              <CalendarIcon size={22} />
            </span>
            <p className="notice-card__text">{notice}</p>
          </div>

          {firstUnassigned ? (
            <a href={`#period-${firstUnassigned.id}`} className="choices__button notice-card__cta">
              View unassigned ({periods.filter(isUnassigned).length})
            </a>
          ) : null}
        </div>
      ) : null}

      <RulesSection
        rules={rules}
        siteId={siteId}
        canAdminister={canAdminister}
        ready={schedules.isSuccess}
      />

      <PeriodsSection
        rules={rules}
        periods={periods}
        siteId={siteId}
        canAdminister={canAdminister}
        year={year}
        onYearChange={setYear}
      />
    </>
  );
}
