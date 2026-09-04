import type { TemplateDraftSummary } from "@hs/contracts";

import { DraftRow } from "./DraftRow";

/**
 * La misma mesa que las publicadas, con las columnas que un borrador sí tiene.
 *
 * "Details" agrupa clave y tipo porque son lo mismo —qué documento es este—, y la fecha
 * sale a columna propia: es el dato por el que el autor decide cuál retomar, y adentro de
 * una línea de contexto no se puede comparar entre filas.
 */
export function DraftList({
  drafts,
  onDiscard,
}: {
  drafts: readonly TemplateDraftSummary[];
  onDiscard: (draft: { id: string; name: string }) => void;
}): React.JSX.Element {
  return (
    <table className="table drafts-card__table" aria-label="Your drafts">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Version</th>
          <th scope="col">Last saved</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {drafts.map((draft) => (
          <DraftRow key={draft.id} draft={draft} onDiscard={onDiscard} />
        ))}
      </tbody>
    </table>
  );
}
