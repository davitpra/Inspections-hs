import { RowMenu } from '../../components/RowMenu';
import { DocumentIcon } from '../../components/icons';
import { saveStateLabel } from './presentation';

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
 *
 * **Y DICE QUÉ SE ESTÁ ESCRIBIENDO.** Corregir una plantilla publicada y escribir una nueva se
 * hacen en el mismo editor, con las mismas piezas, y se ven igual. Lo que las distingue —qué
 * plantilla se corrige y qué número va a tener la versión— tiene que estar arriba: el autor que
 * cree estar escribiendo una plantilla nueva va a tomar decisiones distintas sobre el mismo
 * documento.
 */
export function DraftHeader({
  revising,
  templateName,
  nextVersion,
  dirty,
  onDiscard,
}: {
  revising: boolean;
  templateName: string;
  nextVersion: number;
  dirty: boolean;
  onDiscard: () => void;
}): React.JSX.Element {
  return (
    <header className="scheduling__top">
      <div className="scheduling__header">
        <div className="scheduling__title">
          <span className="scheduling__icon">
            <DocumentIcon size={22} />
          </span>
          <h1>{revising ? 'Revise template' : 'Template builder'}</h1>
        </div>
        <p className="scheduling__subtitle">
          {revising
            ? `Correcting “${templateName}”. Publishing writes version ${nextVersion}; the version it replaces stays readable.`
            : 'Create reusable inspection templates for one plant or both plants.'}
        </p>
      </div>

      <div className="builder__actions">
        <div className="builder__state">
          <span className="status-pill status-pill--draft">
            {revising ? `Revision · version ${nextVersion}` : 'Draft'}
          </span>
          <span className="note">{saveStateLabel(dirty)}</span>
        </div>

        {/*
          El menú vuelve a anclarse por CSS a la esquina del bloque, así que necesita un
          contenedor propio con `position: relative`: colgado del encabezado entero se iría
          a la esquina de la página.
        */}
        <div className="builder__menu-anchor">
          <RowMenu
            label="More template actions"
            actions={[
              {
                label: revising ? 'Discard this revision' : 'Discard this draft',
                tone: 'danger',
                onSelect: onDiscard,
              },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
