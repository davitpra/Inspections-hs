import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useId, useState } from 'react';
import {
  draftIssues,
  type ChoiceOption,
  type ResponseType,
  type TemplateDraft,
  type TemplateDraftDocument,
} from '@hs/contracts';

import { listOrganizationLocations } from '../../api/catalog';
import { getTemplateDraft, saveTemplateDraft } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { InfoIcon } from '../../components/icons';
import { canAuthorTemplates } from '../../permissions/session';
import { itemCountLabel } from '../../presentation/templates';
import {
  addItem,
  addOption,
  addSection,
  allItemKeys,
  changeResponseType,
  moveItem,
  moveSection,
  removeItem,
  removeOption,
  removeSection,
  setConfig,
  setOption,
  setPrompt,
  setRequired,
  setSectionLocation,
} from './edits';
import { newKey } from './newKey';
import { hasUnsavedChanges, saveButtonLabel, saveErrorNotice, totalItems } from './presentation';
import { PublishReadiness } from './PublishReadiness';
import { SectionCard } from './SectionCard';

/**
 * §7 etapa 8 — Escribir una plantilla: secciones, preguntas, tipos de respuesta y orden.
 *
 * EL DOCUMENTO VIVE EN ESTADO LOCAL Y SE GUARDA A PEDIDO. Sin autosave y sin actualización
 * optimista, que es como trabaja el resto de este cliente y lo único compatible con el lock:
 * cada guardado declara la revisión sobre la que se editó, y el servidor rechaza si ya no es
 * esa. Dos pestañas del mismo autor es el caso normal, no el raro.
 *
 * **Un rechazo NO borra lo escrito.** El documento sigue en el `useState`; el aviso dice qué
 * pasó y que nada se perdió. Descartar el trabajo del autor para volver a mostrar lo que el
 * servidor tiene sería la peor forma posible de informar un conflicto.
 *
 * **`draftIssues` corre acá, en cada tecla, con la MISMA función que el servidor.** Es de
 * `@hs/forms` (ADR-007): si fueran dos implementaciones, la pantalla diría que la plantilla
 * está lista y el servidor la rechazaría al publicar.
 *
 * **`visible_when` no se edita**, y el documento no lo pierde: los `edits` lo arrastran
 * intactos. Su regla —la referencia tiene que apuntar estrictamente hacia atrás— interactúa
 * con el reordenamiento de una forma que merece su propio change; mientras tanto,
 * `PublishReadiness` reporta si algún reordenamiento la rompió.
 */
export function TemplateDraftRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const { id } = useParams({ from: '/templates/drafts/$id' });

  if (!canAuthorTemplates(account)) {
    return (
      <>
        <h1>Template</h1>
        <p className="notice">Only the H&amp;S coordinator can write templates.</p>
      </>
    );
  }

  // `key` remonta el editor entero al cambiar de borrador: el estado local es del documento
  // que se está editando, y arrastrarlo de uno a otro escribiría en el equivocado.
  return <DraftEditor key={id} id={id} />;
}

function DraftEditor({ id }: { id: string }): React.JSX.Element {
  const draft = useQuery({
    queryKey: queryKeys.templateDraft(id),
    queryFn: () => getTemplateDraft(id),
    retry: false,
  });
  const organizationLocations = useQuery({
    queryKey: queryKeys.organizationLocations(),
    queryFn: listOrganizationLocations,
    retry: false,
  });

  if (draft.isError) {
    return (
      <>
        <Link to="/templates" className="back-link">
          Templates
        </Link>
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> {(draft.error as Error).message}
        </p>
      </>
    );
  }

  if (!draft.data) {
    return (
      <>
        <Link to="/templates" className="back-link">
          Templates
        </Link>
        <p className="status-card">Loading…</p>
      </>
    );
  }

  /**
   * El formulario se monta recién con el borrador en la mano y siembra su estado del
   * `props`, sin un efecto que lo copie después.
   *
   * `key` es el id y NO el borrador entero: un refetch de fondo devuelve un objeto nuevo con
   * el mismo id, así que el formulario no se remonta y lo que se está escribiendo sobrevive.
   * Para eso está el lock de revisión — avisa en el guardado en vez de borrar sin preguntar.
   */
  return (
    <DraftForm
      key={draft.data.id}
      id={id}
      loaded={draft.data}
      organizationLocations={organizationLocations.data ?? []}
    />
  );
}

function DraftForm({
  id,
  loaded,
  organizationLocations,
}: {
  id: string;
  loaded: TemplateDraft;
  organizationLocations: readonly import('@hs/contracts').OrganizationLocationOption[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();

  /** El documento y el nombre en edición, y la revisión sobre la que se está editando. */
  const [edited, setEdited] = useState(() => ({
    document: loaded.document,
    name: loaded.name,
    revision: loaded.revision,
    savedDocument: loaded.document,
    savedName: loaded.name,
  }));

  const save = useMutation({
    mutationFn: () =>
      saveTemplateDraft(id, {
        name: edited.name.trim(),
        document: edited.document,
        revision: edited.revision,
      }),
    onSuccess: (saved) => {
      setEdited({
        document: saved.document,
        name: saved.name,
        revision: saved.revision,
        savedDocument: saved.document,
        savedName: saved.name,
      });

      void queryClient.invalidateQueries({ queryKey: queryKeys.templateDrafts() });
    },
  });

  const { document } = edited;

  /** Escribe el documento editado sin tocar lo guardado ni la revisión. */
  const write = (next: TemplateDraftDocument): void =>
    setEdited((current) => ({ ...current, document: next }));

  const dirty = hasUnsavedChanges(
    edited.document,
    edited.savedDocument,
    edited.name,
    edited.savedName,
  );

  const issues = draftIssues(document);

  return (
    <>
      <Link to="/templates" className="back-link">
        Templates
      </Link>

      <header className="card">
        <div className="card__head">
          <div className="filters">
            <label htmlFor={`${controlId}-name`}>Template name</label>
            <input
              id={`${controlId}-name`}
              type="text"
              value={edited.name}
              onChange={(event) =>
                setEdited((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <button
            type="button"
            className="button--primary"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || edited.name.trim() === ''}
          >
            {saveButtonLabel(save.isPending, dirty)}
          </button>
        </div>

        {/*
          LA CLAVE, DE SOLO LECTURA Y NO COMO CAMPO.
          El autor no la elige —la deriva el servidor del nombre al crear— y no la puede
          cambiar: es lo que va a identificar a la plantilla publicada y lo que usan los
          seeds. Pero se muestra, y esconderla del todo habría sido peor: renombrar NO la
          mueve, así que una plantilla renombrada queda con una clave que ya no se le parece,
          y el día que alguien lea un seed tiene que poder entender por qué.
        */}
        <p className="note">
          Key <code>{loaded.key}</code> · {document.sections.length} section(s) ·{' '}
          {itemCountLabel(totalItems(document))} · saved revision {edited.revision}
        </p>

        {save.isError ? (
          <p className="notice">{saveErrorNotice((save.error as Error).message)}</p>
        ) : null}
      </header>

      <PublishReadiness issues={issues} />

      {document.sections.map((section, sectionIndex) => (
        // Índice como clave: las identidades técnicas no forman parte de la interfaz y el
        // índice mantiene estable el foco mientras se edita.
        <SectionCard
          key={sectionIndex}
          section={section}
          locations={organizationLocations}
          index={sectionIndex}
          count={document.sections.length}
          onLocation={(code) => {
            const location = organizationLocations.find((each) => each.code === code);
            write(setSectionLocation(document, sectionIndex, code, location?.name ?? ''));
          }}
          onMove={(delta) => write(moveSection(document, sectionIndex, delta))}
          onRemove={() => write(removeSection(document, sectionIndex))}
          onAddItem={() => write(addItem(document, sectionIndex, newKey(allItemKeys(document))))}
          item={{
            /** La identidad se mantiene aunque la pregunta se reformule. */
            prompt: (itemIndex, prompt) =>
              write(setPrompt(document, sectionIndex, itemIndex, prompt)),
            required: (itemIndex, required) =>
              write(setRequired(document, sectionIndex, itemIndex, required)),
            responseType: (itemIndex, responseType: ResponseType) =>
              write(changeResponseType(document, sectionIndex, itemIndex, responseType)),
            number: (itemIndex, field, value) =>
              write(setConfig(document, sectionIndex, itemIndex, field, value)),
            optionChange: (itemIndex, optionIndex, change: Partial<ChoiceOption>) =>
              write(setOption(document, sectionIndex, itemIndex, optionIndex, change)),
            optionAdd: (itemIndex) => write(addOption(document, sectionIndex, itemIndex)),
            optionRemove: (itemIndex, optionIndex) =>
              write(removeOption(document, sectionIndex, itemIndex, optionIndex)),
            move: (itemIndex, delta) =>
              write(moveItem(document, sectionIndex, itemIndex, delta)),
            remove: (itemIndex) => write(removeItem(document, sectionIndex, itemIndex)),
          }}
        />
      ))}

      <div className="card__footer">
        <button
          type="button"
          onClick={() =>
            write(addSection(document, newKey(document.sections.map((section) => section.section_key))))
          }
        >
          Add section
        </button>
      </div>
    </>
  );
}
