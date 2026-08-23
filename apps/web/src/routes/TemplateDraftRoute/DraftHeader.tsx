import { RowMenu } from '../../components/RowMenu';
import { DocumentIcon } from '../../components/icons';
import { publishButtonLabel, saveButtonLabel, saveStateLabel } from './presentation';

/**
 * El encabezado de la consola: qué pantalla es, cómo está el borrador, y el guardado.
 *
 * Reusa el bloque `scheduling__*`, que es el encabezado de página de todas las consolas del
 * coordinador desde la de programación. El nombre quedó del lugar donde nació; el patrón es
 * general y duplicarlo con otro prefijo habría dejado dos encabezados que hay que mantener
 * parecidos a mano.
 *
 * **DICE «Saved» / «Unsaved changes», NO «Auto-saved».** El mockup escribe lo segundo y
 * no se implementa: el guardado es explícito.
 */
export function DraftHeader({
  dirty,
  saving,
  canSave,
  canPublish,
  publishing,
  onSave,
  onPublish,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  canPublish: boolean;
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
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
          <span className="note">{saveStateLabel(dirty)}</span>
        </div>

        <button
          type="button"
          className="button--primary builder__save"
          onClick={onSave}
          disabled={!canSave}
        >
          {saveButtonLabel(saving, dirty)}
        </button>

        <button
          type="button"
          className="button--primary builder__publish"
          onClick={onPublish}
          disabled={!canPublish || publishing}
        >
          {publishButtonLabel(publishing)}
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
