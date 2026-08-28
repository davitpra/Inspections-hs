import type { PendingInspection, Session, Site } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { DownloadForField } from '../../components/FieldPackage';
import { SitePicker } from '../../components/SitePicker';
import type { DraftRow } from '../../offline/db';
import { missingForField, packageDrift, storedTemplateVersion } from '../../offline/prefetch';
import { assignmentState, opensCapture, readiness } from '../../presentation/inspections';
import { AssignmentFacts } from './AssignmentFacts';
import { driftMessage } from './presentation';

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
 * primario, y volver a bajar el paquete, que es secundario y no lo desplaza.
 *
 * Al lado de esas acciones va la planta, con el `SitePicker` en su forma estática: el dato
 * que decide si el inspector está en el lugar correcto no puede quedar tercero en una tira
 * de seis, y por eso ya no está en `AssignmentFacts`.
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
  draftStatus: DraftRow['status'] | null;
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
   * La comparación NO sale a la red: la versión a la que la inspección está congelada ya
   * viaja en la lista de pendientes, y la guardada está en el dispositivo. Pedir el
   * paquete por red para compararlo convertiría una lectura que funciona sin señal en una
   * que no.
   */
  const driftNotice = driftMessage(
    packageDrift({
      storedVersionId: stored.data?.template_version_id,
      frozenVersionId: inspection.template_version_id,
      draftVersionId: draftTemplateVersionId,
      latestVersionId: inspection.latest_template_version_id,
    }),
    draftStatus,
  );

  const decision = assignmentState({
    readiness: readiness(missing.data),
    overdue: inspection.overdue,
    draftStatus,
  });

  return (
    <div className="assignment">
      <div className="assignment__head">
        <div>
          <h1>{inspection.template_name}</h1>
          <p className="scheduling__subtitle">
            Review your assigned inspection details and start completing your checklist.
          </p>
        </div>

        <div className="assignment__actions">
          {/*
           * La planta NO SE ELIGE ACÁ: viene congelada con la asignación. Es el mismo
           * `SitePicker` de las consolas justamente por eso — con una sola opción degrada a
           * texto, así que el inspector lee dónde tiene que estar parado con la misma
           * tarjeta que ya conoce, y no hay un menú que prometa un cambio que no existe.
           * Con la planta dada de baja no queda ninguna opción y también cae en la estática.
           */}
          <SitePicker
            sites={site ? [site] : []}
            value={inspection.site_id}
            onChange={() => {}}
            siteName={() => site?.name ?? inspection.site_id}
          />

          {decision.action === 'download' ? (
            <DownloadForField id={inspection.id} advance={draftStatus === null} />
          ) : null}

          {decision.showsRefresh ? (
            <DownloadForField
              id={inspection.id}
              label="Update offline data"
              className="assignment__action"
              advance={draftStatus === null}
            />
          ) : null}

          {opensCapture(decision.action) ? (
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

      {driftNotice ? <p className="notice notice--warn">{driftNotice}</p> : null}

      <AssignmentFacts
        inspection={inspection}
        account={account}
        pillLabel={decision.pillLabel}
        pillClass={decision.pillClass}
        today={today}
      />
    </div>
  );
}
