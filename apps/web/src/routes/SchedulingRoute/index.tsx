import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listScheduled, listSchedules, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { canAdministerScheduling } from '../permissions';
import { PeriodsSection } from './PeriodsSection';
import { unassignedNotice } from './presentation';
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

  return (
    <>
      <h1>Scheduling</h1>

      <SitePicker
        sites={sites.data ?? []}
        value={siteId}
        onChange={setChosenSite}
        siteName={siteName}
      />

      {schedules.isError || scheduled.isError ? (
        <p className="notice">This view needs a connection.</p>
      ) : null}
      {schedules.isLoading || scheduled.isLoading ? <p>Loading…</p> : null}

      {notice ? <p className="notice notice--warn">{notice}</p> : null}

      <RulesSection
        rules={rules}
        siteId={siteId}
        canAdminister={canAdminister}
        ready={schedules.isSuccess}
      />

      <PeriodsSection periods={periods} siteId={siteId} canAdminister={canAdminister} />
    </>
  );
}
