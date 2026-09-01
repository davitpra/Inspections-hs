import type { EvidenceInput } from '@hs/contracts';

import { UploadIcon } from '../../components/icons';

/**
 * Los archivos que acompañan una transición, antes de subirlos.
 *
 * Solo lo dibuja la etapa que declara el trabajo hecho —`stepForm` decide dónde—, porque es
 * ahí donde alguien distinto va a mirar el trabajo y las fotos son lo que va a mirar.
 */
export function EvidencePicker({
  files,
  onChange,
}: {
  files: { kind: EvidenceInput['kind']; file: File }[];
  onChange: (next: { kind: EvidenceInput['kind']; file: File }[]) => void;
}): React.JSX.Element {
  return (
    <fieldset className="finding__evidence">
      <legend>Evidence</legend>

      {(['before', 'after'] as const).map((kind) => (
        <label key={kind} className="finding__evidence-upload">
          <input
            className="finding__evidence-input"
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
          <span className="finding__evidence-icon">
            <UploadIcon size={20} />
          </span>
          <span>
            <strong>{kind === 'after' ? 'Add after photos' : 'Add before photos'}</strong>
            <small>{kind === 'after' ? 'Add context for verification' : 'Optional context'}</small>
          </span>
        </label>
      ))}

      <p className="finding__evidence-count">
        {files.filter((item) => item.kind === 'after').length} after,{' '}
        {files.filter((item) => item.kind === 'before').length} before
      </p>
    </fieldset>
  );
}
