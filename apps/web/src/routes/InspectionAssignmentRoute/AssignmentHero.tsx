import type { PendingInspection, Session, Site } from "@hs/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { queryKeys } from "../../api/query-keys";
import { DownloadForField } from "../../components/FieldPackage";
import {
  CalendarIcon,
  ClockIcon,
  LockIcon,
  PersonIcon,
  PinIcon,
} from "../../components/icons";
import type { DraftRow } from "../../offline/db";
import {
  missingForField,
  packageDrift,
  prefetchedAt,
  storedTemplateVersion,
} from "../../offline/prefetch";
import { displayName } from "../../presentation/account";
import { formatInstant, periodLabel } from "../../presentation/dates";
import {
  assignmentState,
  dueIn,
  readiness,
} from "../../presentation/inspections";
import { driftMessage } from "./presentation";

/**
 * La asignación que importa AHORA: título, la única acción que corresponde, y la tira de
 * datos que la identifica. Es el héroe de la pantalla: debajo va su progreso, y más abajo
 * lo que sigue y lo que ya se cerró.
 *
 * Consulta `fieldReady` con la MISMA clave que `AssignmentChecklist` y la captura: no
 * agrega una llamada, lee la caché que las tres comparten — y que `FieldPackage`
 * invalida para todas cuando el paquete termina de bajar.
 *
 * Con el paquete completo la tarjeta ofrece DOS cosas: salir a recorrer, que es lo
 * primario, y volver a bajar el paquete, que es secundario y no lo desplaza. El sello de
 * la descarga va en la tira de datos porque es lo que hace que refrescar sea una decisión
 * y no una apuesta.
 */
export function AssignmentHero({
  inspection,
  site,
  account,
  draftStatus,
  draftTemplateVersionId,
  today,
}: {
  inspection: PendingInspection;
  site: Site | undefined;
  account: Session;
  draftStatus: DraftRow["status"] | null;
  /** La versión que el borrador congeló, si hay borrador. Es la mitad de la deriva. */
  draftTemplateVersionId: string | null;
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

  /**
   * Cuándo se bajó. Consulta aparte de la anterior porque contesta otra pregunta —qué tan
   * viejo es esto— y es la que justifica el botón de volver a bajar: sin la fecha,
   * refrescar es una apuesta.
   */
  const fetchedAt = useQuery({
    queryKey: queryKeys.prefetchedAt(inspection.id),
    queryFn: () => prefetchedAt(inspection.id),
  });

  const state = readiness(missing.data);

  /**
   * La comparación NO sale a la red: la versión a la que la inspección está congelada ya
   * viaja en la lista de pendientes, y la guardada está en el dispositivo. Pedir el
   * paquete por red para compararlo convertiría una lectura que funciona sin señal en una
   * que no.
   */
  const drift = packageDrift({
    storedVersionId: stored.data?.template_version_id,
    frozenVersionId: inspection.template_version_id,
    draftVersionId: draftTemplateVersionId,
    latestVersionId: inspection.latest_template_version_id,
  });
  const driftNotice = driftMessage(drift, draftStatus);
  const decision = assignmentState({
    readiness: state,
    overdue: inspection.overdue,
    draftStatus,
  });
  const showsCapturePrimary =
    decision.action === "start" ||
    decision.action === "resume" ||
    decision.action === "open";

  return (
    <div className="assignment">
      <div className="assignment__head">
        <div>
          <h1>{inspection.template_name}</h1>
          <p className="scheduling__subtitle">
            Review your assigned inspection details and start completing your
            checklist.
          </p>
        </div>

        <div className="assignment__actions">
          {decision.action === "download" ? (
            <DownloadForField
              id={inspection.id}
              advance={draftStatus === null}
            />
          ) : null}

          {decision.showsRefresh ? (
            <DownloadForField
              id={inspection.id}
              label="Update offline data"
              className="assignment__action"
              advance={draftStatus === null}
            />
          ) : null}

          {showsCapturePrimary ? (
            <Link
              to="/inspections/$id/capture"
              params={{ id: inspection.id }}
              className="assignment__cta"
            >
              {decision.actionLabel}
            </Link>
          ) : null}
        </div>
      </div>

      {driftNotice ? (
        <p className="notice notice--warn">{driftNotice}</p>
      ) : null}

      <dl className="facts">
        <div className="facts__item">
          <span className="facts__label">
            <PinIcon size={16} /> Site
          </span>
          <span className="facts__value">{site?.name ?? "—"}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <CalendarIcon size={16} /> Inspection month
          </span>
          <span className="facts__value">
            {periodLabel(inspection.period_start, inspection.period_months)}
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
            <span className="facts__hint">
              {dueIn(inspection.period_end, today)}
            </span>
          </span>
        </div>

        {stored.data ? (
          <div className="facts__item">
            <span className="facts__label">
              <LockIcon size={16} /> Template version
            </span>
            <span className="facts__value">
              Version {stored.data.version}
              <span className="facts__hint">
                {fetchedAt.data
                  ? `Downloaded ${formatInstant(fetchedAt.data)}`
                  : "Locked"}
              </span>
              {inspection.latest_template_version >
              inspection.template_version ? (
                <span className="facts__hint">
                  Version {inspection.latest_template_version} is published
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
