import type { TemplateDraftSummary } from '@hs/contracts';

import { DraftRow } from './DraftRow';

export function DraftList({
  drafts,
  onDiscard,
}: {
  drafts: readonly TemplateDraftSummary[];
  onDiscard: (draft: { id: string; name: string }) => void;
}): React.JSX.Element {
  return (
    <ul className="list">
      {drafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} onDiscard={onDiscard} />
      ))}
    </ul>
  );
}
