import type { EvidenceInput } from '@hs/contracts';

import { UploadIcon } from './icons';

/** Los archivos que acompañan una transición, antes de subirlos. */
export function EvidencePicker({
  files,
  onChange,
}: {
  files: { kind: EvidenceInput['kind']; file: File }[];
  onChange: (next: { kind: EvidenceInput['kind']; file: File }[]) => void;
}): React.JSX.Element {
  return (
    <fieldset className="action-detail__evidence">
      <legend>Evidence</legend>

      {(['before', 'after'] as const).map((kind) => (
        <label key={kind} className="action-detail__evidence-upload">
          <input
            className="action-detail__file-input"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={(event) =>
              onChange([
                ...files.filter((item) => item.kind !== kind),
                ...Array.from(event.target.files ?? []).map((file) => ({ kind, file })),
              ])
            }
          />
          <span className="action-detail__upload-icon">
            <UploadIcon size={20} />
          </span>
          <span>
            <strong>{kind === 'after' ? 'Add after photos' : 'Add before photos'}</strong>
            <small>{kind === 'after' ? 'Add context for verification' : 'Optional context'}</small>
          </span>
        </label>
      ))}

      <p className="action-detail__evidence-count">
        {files.filter((item) => item.kind === 'after').length} after,{' '}
        {files.filter((item) => item.kind === 'before').length} before
      </p>
    </fieldset>
  );
}
