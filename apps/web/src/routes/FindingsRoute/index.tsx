import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listFindings } from '../../api/findings';
import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { AlertCircleIcon } from '../../components/icons';
import { completedInspections } from '../../presentation/inspections';
import { inspectionsWithFindings } from './presentation';

/**
 * Lo que salió mal, y en qué recorrido.
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

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
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

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const completed = account ? completedInspections(scheduled.data ?? [], account.userId) : [];
  const withFindings = inspectionsWithFindings(completed, findings.data ?? []);

  /*
    Las DOS consultas de red tienen que haber llegado para poder afirmar que no hay nada.
    Con los hallazgos caídos, `withFindings` da vacío aunque las inspecciones estén: eso no
    es "ninguna dejó hallazgos", es "no se sabe", y decir lo primero sería declarar limpia
    una planta que nadie pudo leer.
  */
  const loaded = scheduled.isSuccess && findings.isSuccess;
  const failed = scheduled.isError || findings.isError;

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
            The inspections you completed that recorded something to fix, most recent first.
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

      {loaded && withFindings.length === 0 ? (
        <p>None of the inspections you completed recorded a finding.</p>
      ) : null}

      {withFindings.length > 0 ? (
        <CompletedInspectionsTable
          inspections={withFindings}
          siteName={siteName}
          to="/findings/$id"
          actionLabel="View findings"
        />
      ) : null}
    </>
  );
}
