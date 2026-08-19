import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { listTemplateDrafts } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { GridIcon, InfoIcon } from '../../components/icons';
import { canAuthorTemplates } from '../../permissions/session';
import { formatInstant } from '../../presentation/dates';
import { draftStatusClass, draftStatusLabel } from '../../presentation/templates';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { NewDraftForm } from './NewDraftForm';
import { sortDrafts } from './presentation';

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

function TemplateDrafts(): React.JSX.Element {
  /**
   * El borrador que se está descartando, ACÁ y no en la fila que lo originó: descartar
   * invalida el listado y la fila deja de montarse. El diálogo sobrevive porque cuelga de
   * la ruta. Ver `DiscardDraftDialog.tsx`.
   */
  const [discarding, setDiscarding] = useState<{ id: string; name: string } | null>(null);

  const drafts = useQuery({
    queryKey: queryKeys.templateDrafts(),
    queryFn: listTemplateDrafts,
    retry: false,
  });

  const visible = sortDrafts(drafts.data ?? []);

  return (
    <>
      <h1>Templates</h1>

      {/*
        Lo que esta pantalla NO hace, dicho arriba y no escondido en un botón deshabilitado:
        sin esta línea, el coordinador escribe una plantilla entera y recién al final
        descubre que no puede usarla.
      */}
      <p className="note">
        These are drafts. Publishing a template so it can be scheduled is not available yet —
        a draft is saved, reordered and reviewed here, and published in a later release.
      </p>

      <NewDraftForm />

      {drafts.isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {drafts.isLoading ? (
        <p className="status-card">
          <GridIcon size={20} /> Loading…
        </p>
      ) : null}

      {drafts.isSuccess && visible.length === 0 ? (
        <p>No drafts yet. Start one above.</p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="list">
          {visible.map((draft) => (
            <li key={draft.id} className="list__row">
              <div>
                {/*
                  El nombre es el link: abrir el borrador es lo que se hace con él el 95% de
                  las veces, y un botón "Edit" al costado pondría dos objetivos donde hay uno.
                */}
                <Link to="/templates/drafts/$id" params={{ id: draft.id }}>
                  {draft.name}
                </Link>
                {/*
                  La clave se muestra en el listado porque es lo que la plantilla va a llevar
                  para siempre, y porque dos borradores con nombres parecidos se distinguen
                  por ella y no por el nombre.
                */}
                <p className="note">
                  {draft.key} · last saved {formatInstant(draft.updated_at)}
                </p>
              </div>

              <div className="list__aside">
                <span className={draftStatusClass(draft.publishable)}>
                  {draftStatusLabel(draft.publishable)}
                </span>

                <button
                  type="button"
                  className="button--danger-quiet"
                  aria-label={`Discard ${draft.name}`}
                  onClick={() => setDiscarding({ id: draft.id, name: draft.name })}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Montaje condicional: cada apertura crea el diálogo de nuevo, así que `showModal()`
        corre una sola vez por borrador.
      */}
      {discarding ? (
        <DiscardDraftDialog
          draftId={discarding.id}
          draftName={discarding.name}
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}
