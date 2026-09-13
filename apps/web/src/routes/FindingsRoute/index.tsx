import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listFindings } from '../../api/findings';
import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { AlertCircleIcon } from '../../components/icons';
import { canReviewSiteInspections } from '../../permissions/session';
import { inspectionsWithFindings } from '../../presentation/findings';
import {
  completedInspections,
  inspectionTypeGroups,
  templateNamePhrase,
} from '../../presentation/inspections';

/**
 * Los recorridos que esta cuenta puede revisar y que dejaron algo que arreglar, separados por tipo.
 *
 * El historial contesta «qué cerré» y el reporte contesta «qué contesté»; esta pantalla
 * contesta la pregunta que se hace al día siguiente —«qué encontré»— y por eso ESCONDE LA
 * INSPECCIÓN LIMPIA. Un período que se cerró sin nada que arreglar es una buena noticia,
 * no una fila que revisar, y dejarlo acá obligaría a distinguir a ojo cuáles de veinte
 * filas valen la pena abrir. El que quiera la lista completa la tiene en `/historical`.
 *
 * TRES CONSULTAS, NINGUNA CLAVE NUEVA. Las mismas que ya usan la pantalla de inicio, el
 * historial y las acciones correctivas, así que llegar acá desde cualquiera de ellas lee
 * la caché que ya está tibia en vez de volver a pedir.
 *
 * De servidor y sin reintento, como el historial: no es trabajo en curso y no tiene por
 * qué estar en el dispositivo (ADR-010).
 */
export function FindingsRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const canReviewAll = canReviewSiteInspections(account);

  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });
  const findings = useQuery({
    queryKey: queryKeys.findings(),
    queryFn: listFindings,
    retry: false,
  });
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });

  const completed = account
    ? completedInspections(scheduled.data ?? [], account.userId, canReviewAll)
    : [];
  const withFindings = inspectionsWithFindings(completed, findings.data ?? []);
  const types = inspectionTypeGroups(withFindings);

  /*
    Las TRES consultas de red tienen que haber llegado para poder afirmar que no hay nada.
    Con los hallazgos caídos, `withFindings` da vacío aunque las inspecciones estén: eso no
    es "ninguna dejó hallazgos", es "no se sabe", y decir lo primero sería declarar limpia
    una planta que nadie pudo leer.
  */
  const loaded = scheduled.isSuccess && findings.isSuccess && sites.isSuccess;
  const failed = scheduled.isError || findings.isError || sites.isError;
  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <AlertCircleIcon size={22} />
            </span>
            <h1>Findings</h1>
          </div>
          <p className="scheduling__subtitle">
            {canReviewAll
              ? 'Review every inspection in your sites where a finding was recorded, grouped by type.'
              : 'Review every inspection where you recorded something to fix, grouped by type.'}
          </p>
        </div>
      </header>

      <p>
        <Link className="back-link" to="/">
          Back to my inspections
        </Link>
      </p>

      {failed ? (
        <p className="notice">
          Findings need a connection. They are kept on the server, not on this device.
        </p>
      ) : null}

      {!failed && !loaded ? <p className="status-card">Loading findings…</p> : null}

      {loaded && withFindings.length === 0 ? (
        <p>
          {canReviewAll
            ? 'None of the completed inspections in your sites recorded a finding.'
            : 'None of the inspections you completed recorded a finding.'}
        </p>
      ) : null}

      {loaded && types.length > 0 ? (
        <div className="inspection-groups">
          {types.map((group) => {
            const headingId = `findings-type-${group.templateId}`;

            return (
              <section
                key={group.templateId}
                className="inspection-group"
                aria-labelledby={headingId}
              >
                <div className="inspection-group__head">
                  <h2 id={headingId}>
                    {group.templateName}
                    <span className="inspection-group__count">
                      {` (${group.inspections.length})`}
                    </span>
                  </h2>
                  <p className="inspection-group__blurb">
                    {/*
                      "Only" y no "All": esta pantalla esconde a propósito el recorrido
                      limpio, y decirlo acá es lo que evita que la tabla se lea como el
                      historial completo del tipo.
                    */}
                    Only the {templateNamePhrase(group.templateName)} that recorded a
                    finding.
                  </p>
                </div>
                <CompletedInspectionsTable
                  inspections={group.inspections}
                  siteName={siteName}
                  to="/findings/$id"
                  actionLabel="View findings"
                  ariaLabel={`${group.templateName} inspections with findings`}
                  showInspector={canReviewAll}
                />
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
