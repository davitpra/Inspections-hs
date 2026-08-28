import type { PendingInspection, Session } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../api/query-keys';
import { Fact, Facts } from '../../components/Facts';
import { CalendarIcon, ClockIcon, LockIcon, PersonIcon } from '../../components/icons';
import { prefetchedAt, storedTemplateVersion } from '../../offline/prefetch';
import { displayName } from '../../presentation/account';
import { periodLabel } from '../../presentation/dates';
import { dueIn } from '../../presentation/inspections';
import { versionHints } from './presentation';

/**
 * Los datos que identifican la asignación: cuándo, de quién, y qué versión del formulario
 * hay bajada en ESTE dispositivo.
 *
 * El DÓNDE no está acá: lo dice la tarjeta de planta del encabezado, arriba en la misma
 * caja. Repetirlo en la tira era el mismo nombre dos veces a tres centímetros.
 *
 * Las dos consultas salen de la caché que la tarjeta comparte con el resto de la
 * pantalla —mismas claves que `AssignmentHero` y la captura, que `FieldPackage` invalida
 * para todas cuando el paquete termina de bajar—, así que separarlo del héroe no agrega
 * una llamada. Son dos y no una porque contestan cosas distintas: qué versión hay, y qué
 * tan vieja es.
 *
 * La versión aparece solo si hay paquete: sin nada bajado no hay versión que declarar, y
 * un renglón vacío se leería como que la hay.
 */
export function AssignmentFacts({
  inspection,
  account,
  pillLabel,
  pillClass,
  today,
}: {
  inspection: PendingInspection;
  account: Session;
  pillLabel: string;
  pillClass: string;
  today: string;
}): React.JSX.Element {
  const stored = useQuery({
    queryKey: queryKeys.storedTemplateVersion(inspection.id),
    queryFn: () => storedTemplateVersion(inspection.id),
  });

  const fetchedAt = useQuery({
    queryKey: queryKeys.prefetchedAt(inspection.id),
    queryFn: () => prefetchedAt(inspection.id),
  });

  return (
    <Facts>
      <Fact
        icon={<CalendarIcon size={16} />}
        label="Inspection month"
        value={periodLabel(inspection.period_start, inspection.period_months)}
      />

      <Fact
        icon={<PersonIcon size={16} />}
        label="Assigned inspector"
        value={displayName(account)}
      />

      {pillLabel ? (
        <Fact label="Status" value={<span className={pillClass}>{pillLabel}</span>} />
      ) : null}

      <Fact
        icon={<ClockIcon size={16} />}
        label="Due date"
        value={inspection.period_end}
        hints={[dueIn(inspection.period_end, today)]}
      />

      {stored.data ? (
        <Fact
          icon={<LockIcon size={16} />}
          label="Template version"
          value={`Version ${stored.data.version}`}
          hints={versionHints({
            fetchedAt: fetchedAt.data,
            frozenVersion: inspection.template_version,
            latestVersion: inspection.latest_template_version,
          })}
        />
      ) : null}
    </Facts>
  );
}
