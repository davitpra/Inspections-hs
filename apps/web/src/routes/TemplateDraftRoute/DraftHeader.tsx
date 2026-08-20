import { RowMenu } from '../../components/RowMenu';
import { DocumentIcon } from '../../components/icons';
import { saveButtonLabel, saveStateLabel } from './presentation';

/**
 * El encabezado de la consola: qué pantalla es, cómo está el borrador, y el guardado.
 *
 * Reusa el bloque `scheduling__*`, que es el encabezado de página de todas las consolas del
 * coordinador desde la de programación. El nombre quedó del lugar donde nació; el patrón es
 * general y duplicarlo con otro prefijo habría dejado dos encabezados que hay que mantener
 * parecidos a mano.
 *
 * **DICE «Saved revision N», NO «Auto-saved».** El mockup escribe lo segundo y no se
 * implementa: no hay autosave, y no lo hay porque el lock de revisión y el guardado
 * automático se contradicen —dos ventanas del mismo autor es el caso normal, y una de las
 * dos empezaría a perder contra la otra sin que nadie toque un botón—. Un encabezado que
 * dijera «Auto-saved 2 min ago» sobre un editor que no guarda solo sería la peor clase de
 * mentira: la que tranquiliza.
 */
export function DraftHeader({
  revision,
  dirty,
  saving,
  canSave,
  onSave,
  onDiscard,
}: {
  revision: number;
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  return (
    <header className="scheduling__top">
      <div className="scheduling__header">
        <div className="scheduling__title">
          <span className="scheduling__icon">
            <DocumentIcon size={22} />
          </span>
          <h1>Template builder</h1>
        </div>
        <p className="scheduling__subtitle">
          Create reusable inspection templates for one plant or both plants.
        </p>
      </div>

      <div className="builder__actions">
        <div className="builder__state">
          <span className="status-pill status-pill--draft">Draft</span>
          <span className="note">{saveStateLabel(revision, dirty)}</span>
        </div>

        <button
          type="button"
          className="button--primary builder__save"
          onClick={onSave}
          disabled={!canSave}
        >
          {saveButtonLabel(saving, dirty)}
        </button>

        {/*
          El menú vuelve a anclarse por CSS a la esquina del bloque, así que necesita un
          contenedor propio con `position: relative`: colgado del encabezado entero se iría
          a la esquina de la página.
        */}
        <div className="builder__menu-anchor">
          <RowMenu
            label="More template actions"
            actions={[{ label: 'Discard this draft', tone: 'danger', onSelect: onDiscard }]}
          />
        </div>
      </div>
    </header>
  );
}
