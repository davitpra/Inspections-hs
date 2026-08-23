import { DocumentIcon, LockIcon } from '../../components/icons';
import { useAppSession } from '../../app/session-context';
import { canAuthorTemplates } from '../../permissions/session';
import { TemplateDrafts } from './TemplateDrafts';

/**
 * §7 etapa 8 — Las plantillas que se están escribiendo.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. Hasta acá una plantilla entraba al sistema de una sola
 * forma: un archivo `.sql` corrido por `hs_migrator`. Reformular una pregunta era un cambio
 * de código, una revisión de migración y un despliegue, y el coordinador —que es quien sabe
 * qué hay que preguntar— dependía del desarrollador para cada palabra.
 *
 * **BORRADORES Y PUBLICADAS SON DOS POBLACIONES.** Un borrador todavía puede cambiar y no
 * puede programarse; una publicación es un registro congelado que aparece en la tarjeta de
 * abajo. La distinción no es un detalle de implementación — es la que permite que escribir
 * una plantilla no toque ni una fila del modelo inmutable.
 *
 * **El rol se comprueba también en la LECTURA**, al revés que `/scheduling` y como
 * `/roster`: el servidor contesta `template_draft_forbidden` en las cinco rutas, así que una
 * pantalla de solo lectura para otro rol sería una pantalla vacía con un error.
 *
 * ONLINE y fuera del precacheo: se escribe sentado, con conexión, y puede llevar días.
 * ADR-001 acepta perder un borrador de INSPECCIÓN porque la alternativa es sincronizar
 * trabajo de campo sin señal; nada de eso aplica acá.
 */
export function TemplatesRoute(): React.JSX.Element {
  const { account } = useAppSession();

  if (!canAuthorTemplates(account)) {
    // Y sin disparar ninguna consulta: pedir algo que el servidor va a negar solo sirve
    // para llenar el log de 403. Mismo criterio que `RosterRoute`.
    //
    // El encabezado se dibuja igual que en la pantalla completa: quien llega acá tiene que
    // saber en qué pantalla está antes de leer por qué no puede usarla. El aviso es un
    // `.status-card` y no un `.status-card--error`: no falló nada, esta pantalla no es suya.
    return (
      <>
        <header className="scheduling__top">
          <div className="scheduling__header">
            <div className="scheduling__title">
              <span className="scheduling__icon">
                <DocumentIcon size={22} />
              </span>
              <h1>Templates</h1>
            </div>
          </div>
        </header>

        <p className="status-card">
          <LockIcon size={20} /> Only the H&amp;S coordinator can write templates.
        </p>
      </>
    );
  }

  return <TemplateDrafts />;
}
