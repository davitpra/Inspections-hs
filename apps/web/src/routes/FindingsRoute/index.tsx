import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listFindings } from '../../api/findings';
import { listScheduled } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { InspectionTypeIndexTable } from '../../components/InspectionTypeIndexTable';
import { AlertCircleIcon } from '../../components/icons';
import { inspectionsWithFindings } from '../../presentation/findings';
import { completedInspections, inspectionTypeGroups } from '../../presentation/inspections';

/**
 * Los tipos de recorrido en los que esta cuenta encontró algo que arreglar.
 *
 * El historial contesta «qué cerré» y el reporte contesta «qué contesté»; esta pantalla
 * contesta la pregunta que se hace al día siguiente —«qué encontré»— y por eso ESCONDE LA
 * INSPECCIÓN LIMPIA. Un período que se cerró sin nada que arreglar es una buena noticia,
 * no una fila que revisar, y dejarlo acá obligaría a distinguir a ojo cuáles de veinte
 * filas valen la pena abrir. El que quiera la lista completa la tiene en `/historical`.
 *
 * DOS CONSULTAS, NINGUNA CLAVE NUEVA. Las mismas que ya usan la pantalla de inicio, el
 * historial y las acciones correctivas, así que llegar acá desde cualquiera de ellas lee
 * la caché que ya está tibia en vez de volver a pedir.
 *
 * De servidor y sin reintento, como el historial: no es trabajo en curso y no tiene por
 * qué estar en el dispositivo (ADR-010).
 */
export function FindingsRoute(): React.JSX.Element {
  const { account } = useAppSession();

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

  const completed = account ? completedInspections(scheduled.data ?? [], account.userId) : [];
  const withFindings = inspectionsWithFindings(completed, findings.data ?? []);
  const types = inspectionTypeGroups(withFindings);

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
            Choose an inspection type to review what you found.
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
        <p>None of the inspections you completed recorded a finding.</p>
      ) : null}

      {withFindings.length > 0 ? (
        <InspectionTypeIndexTable
          groups={types}
          to="/findings/types/$templateId"
          ariaLabel="Inspection types with findings"
          countLabel="Inspections with findings"
        />
      ) : null}
    </>
  );
}
