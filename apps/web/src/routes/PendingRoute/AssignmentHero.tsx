import type { PendingInspection, Session, Site } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { DownloadForField } from '../../components/FieldPackage';
import { CalendarIcon, ClockIcon, LockIcon, PersonIcon, PinIcon } from '../../components/icons';
import type { DraftRow } from '../../offline/db';
import { missingForField, storedTemplateVersion } from '../../offline/prefetch';
import { displayName } from '../../presentation/account';
import { monthName } from '../../presentation/dates';
import { assignmentState, dueIn, readiness } from './presentation';

/**
 * La asignación que importa AHORA: título, la única acción que corresponde, y la tira de
 * datos que la identifica. Es el héroe de la pantalla — el resto del año sigue debajo,
 * en la misma grilla de siempre.
 *
 * Consulta `fieldReady` con la MISMA clave que `PendingRow`: no agrega una llamada, lee
 * la misma caché que la tarjeta del mes en la grilla de abajo tendría si estuviera ahí.
 */
export function AssignmentHero({
  inspection,
  site,
  account,
  draftStatus,
  today,
}: {
  inspection: PendingInspection;
  site: Site | undefined;
  account: Session;
  draftStatus: DraftRow['status'] | null;
  today: string;
}): React.JSX.Element {
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });

  const stored = useQuery({
    queryKey: queryKeys.storedTemplateVersion(inspection.id),
    queryFn: () => storedTemplateVersion(inspection.id),
  });

  const state = readiness(missing.data);
  const decision = assignmentState({
    readiness: state,
    overdue: inspection.overdue,
    draftStatus,
  });
  const showsCapturePrimary =
    decision.action === 'start' || decision.action === 'resume' || decision.action === 'open';

  return (
    <div className="assignment">
      <div className="assignment__head">
        <div>
          <h2>{inspection.template_name}</h2>
          <p className="scheduling__subtitle">
            Review your assigned inspection details and start completing your checklist.
          </p>
        </div>

        <div className="assignment__actions">
          {showsCapturePrimary ? (
            <Link
              to="/inspections/$id/capture"
              params={{ id: inspection.id }}
              className="assignment__cta"
            >
              {decision.actionLabel}
            </Link>
          ) : null}

          {decision.action === 'download' ? <DownloadForField id={inspection.id} /> : null}
        </div>
      </div>

      <dl className="facts">
        <div className="facts__item">
          <span className="facts__label">
            <PinIcon size={16} /> Site
          </span>
          <span className="facts__value">{site?.name ?? '—'}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <CalendarIcon size={16} /> Inspection month
          </span>
          <span className="facts__value">
            {monthName(inspection.period_start)} {inspection.period_start.slice(0, 4)}
          </span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PersonIcon size={16} /> Assigned inspector
          </span>
          <span className="facts__value">{displayName(account)}</span>
        </div>

        {decision.pillLabel ? (
          <div className="facts__item">
            <span className="facts__label">Status</span>
            <span className={decision.pillClass}>{decision.pillLabel}</span>
          </div>
        ) : null}

        <div className="facts__item">
          <span className="facts__label">
            <ClockIcon size={16} /> Due date
          </span>
          <span className="facts__value">
            {inspection.period_end}
            <span className="facts__hint">{dueIn(inspection.period_end, today)}</span>
          </span>
        </div>

        {stored.data ? (
          <div className="facts__item">
            <span className="facts__label">
              <LockIcon size={16} /> Template version
            </span>
            <span className="facts__value">
              Version {stored.data.version}
              <span className="facts__hint">Locked</span>
            </span>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
