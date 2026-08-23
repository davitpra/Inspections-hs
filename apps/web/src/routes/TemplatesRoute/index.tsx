import { useQuery } from "@tanstack/react-query";

import { listTemplates } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { listTemplateDrafts } from "../../api/templates";
import { DocumentIcon, LockIcon } from "../../components/icons";
import { useAppSession } from "../../app/session-context";
import { canAuthorTemplates } from "../../permissions/session";
import { PublishedTemplates } from "./PublishedTemplates";
import { TemplateCounts } from "./TemplateCounts";
import { TemplateDrafts } from "./TemplateDrafts";

/**
 * §7 etapa 8 — Las plantillas publicadas como referencia y las que se están escribiendo.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. Hasta acá una plantilla entraba al sistema de una sola
 * forma: un archivo `.sql` corrido por `hs_migrator`. Reformular una pregunta era un cambio
 * de código, una revisión de migración y un despliegue, y el coordinador —que es quien sabe
 * qué hay que preguntar— dependía del desarrollador para cada palabra.
 *
 * **BORRADORES Y PUBLICADAS SON DOS POBLACIONES.** Un borrador todavía puede cambiar y no
 * puede programarse; una publicación es un registro congelado que aparece en la tarjeta de
 * arriba y se puede abrir para leer su versión exacta. La distinción no es un detalle de
 * implementación — es la que permite que escribir una plantilla no toque ni una fila del
 * modelo inmutable.
 *
 * **El rol se comprueba también en la LECTURA**, al revés que `/scheduling` y como
 * `/roster`: el servidor contesta `template_draft_forbidden` en las cinco rutas, así que una
 * pantalla de solo lectura para otro rol sería una pantalla vacía con un error.
 *
 * ONLINE y fuera del precacheo: se escribe sentado, con conexión, y puede llevar días.
 * ADR-001 acepta perder un borrador de INSPECCIÓN porque la alternativa es sincronizar
 * trabajo de campo sin señal; nada de eso aplica acá.
 *
 * EL ENCABEZADO ES DE LA RUTA, no de la consola de borradores. Estaba escrito dos veces
 * —una acá para el rol equivocado y otra adentro de `TemplateDrafts`— y dos copias del
 * mismo título se separan la primera vez que alguien toca una sola. Además es lo que deja
 * poner las dos poblaciones contadas al costado: `.scheduling__top` reparte con
 * `space-between`, y con un solo hijo la mitad derecha del encabezado quedaba vacía.
 */
export function TemplatesRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const canAuthor = canAuthorTemplates(account);

  /**
   * Las dos consultas de la pantalla, ACÁ: cada una alimenta a la vez su tarjeta y su
   * ficha del encabezado, y el conteo de arriba tiene que ser el mismo número que el de
   * abajo. `TemplateDrafts` pide los borradores con esta misma clave y la caché de
   * TanStack resuelve las dos con un solo pedido.
   *
   * `enabled` mantiene la promesa del guard de abajo — el hook corre siempre, porque no
   * puede correr condicionalmente, pero sin rol no sale ninguna consulta.
   */
  const drafts = useQuery({
    queryKey: queryKeys.templateDrafts(),
    queryFn: listTemplateDrafts,
    retry: false,
    enabled: canAuthor,
  });

  const published = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    retry: false,
    enabled: canAuthor,
  });

  return (
    <>
      {/*
        El mismo encabezado que la consola de programación y que el builder: el coordinador
        se mueve entre las tres, y tres títulos con tres formas distintas se leen como tres
        aplicaciones. Ver `DraftHeader` en `TemplateDraftRoute`.

        El subtítulo se dibuja también para el rol que no puede escribir: saber qué es esta
        pantalla es justamente lo que le falta a quien llegó por el menú y no puede usarla.
      */}
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <DocumentIcon size={22} />
            </span>
            <h1>Templates</h1>
          </div>
          <p className="scheduling__subtitle">
            Write the questions an inspection asks, and keep working on them
            until they are ready.
          </p>
        </div>

        {canAuthor ? (
          <TemplateCounts
            drafts={drafts.data?.length}
            published={published.data?.length}
          />
        ) : null}
      </header>

      {canAuthor ? (
        <>
          <PublishedTemplates
            templates={published.data ?? []}
            isLoading={published.isLoading}
            isError={published.isError}
          />
          <TemplateDrafts />
        </>
      ) : (
        // Y sin disparar ninguna consulta: pedir algo que el servidor va a negar solo sirve
        // para llenar el log de 403. Mismo criterio que `RosterRoute`.
        //
        // El aviso es un `.status-card` y no un `.status-card--error`: no falló nada, esta
        // pantalla no es suya.
        <p className="status-card">
          <LockIcon size={20} /> Only the H&amp;S coordinator can write
          templates.
        </p>
      )}
    </>
  );
}
