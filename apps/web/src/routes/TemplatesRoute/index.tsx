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
 * **ESTO SON BORRADORES, NO PLANTILLAS.** Nada de lo que se lista acá puede programarse
 * todavía: publicar es la segunda mitad de la etapa 8 y no existe ningún endpoint que lo
 * haga. La distinción no es un detalle de implementación — es la que permite que escribir
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
    return (
      <>
        <h1>Templates</h1>
        <p className="notice">Only the H&amp;S coordinator can write templates.</p>
      </>
    );
  }

  return <TemplateDrafts />;
}
