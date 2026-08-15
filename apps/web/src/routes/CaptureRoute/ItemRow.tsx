import type { TemplateItem } from '@hs/forms';
import type { LocationOption } from '@hs/contracts';

import { FindingFields } from '../../components/FindingFields';
import { ItemInput } from '../../components/ItemInput';
import type { FindingDraftRow, PhotoRow } from '../../offline/db';

/**
 * Un ítem de la recorrida: la pregunta, la respuesta, y el hallazgo cuando la respuesta
 * es negativa.
 *
 * `negative` LLEGA CALCULADO y no se decide acá. Quién es una respuesta negativa lo dice
 * `negativeAnswers` de `@hs/forms` sobre el documento entero, que es el mismo código que
 * el servidor corre al recibir el envío (ADR-007). Un `value === false` escrito en este
 * componente sería la segunda opinión del cliente que ADR-007 existe para evitar.
 *
 * El `onFocus` está en el contenedor y no en cada control: sirve para recordar por dónde
 * iba la recorrida si el proceso muere, y para eso alcanza con saber el ítem.
 */
export function ItemRow({
  item,
  value,
  invalid,
  negative,
  answerPhotos,
  findingPhotos,
  finding,
  locations,
  readOnly,
  onFocus,
  onChange,
  onFindingChange,
  onCapturePhoto,
  onDiscardPhoto,
}: {
  item: TemplateItem;
  value: unknown;
  invalid: boolean;
  negative: boolean;
  answerPhotos: PhotoRow[];
  findingPhotos: PhotoRow[];
  finding: FindingDraftRow | undefined;
  locations: LocationOption[];
  readOnly: boolean;
  onFocus: () => void;
  onChange: (value: unknown) => void;
  onFindingChange: (patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>) => void;
  onCapturePhoto: (blob: Blob, kind?: 'answer' | 'finding') => void;
  onDiscardPhoto: (photoId: string) => void;
}): React.JSX.Element {
  return (
    <div className="item" onFocus={onFocus}>
      <label htmlFor={`item-${item.item_key}`}>
        {item.prompt}
        {item.required ? <span aria-hidden="true"> *</span> : null}
      </label>

      <fieldset disabled={readOnly}>
        <ItemInput
          item={item}
          value={value}
          invalid={invalid}
          photos={answerPhotos}
          onChange={onChange}
          onCapturePhoto={(blob) => onCapturePhoto(blob)}
          onDiscardPhoto={onDiscardPhoto}
        />

        {negative ? (
          <FindingFields
            itemKey={item.item_key}
            finding={finding}
            photos={findingPhotos}
            locations={locations}
            disabled={readOnly}
            onChange={onFindingChange}
            onCapturePhoto={(blob) => onCapturePhoto(blob, 'finding')}
            onDiscardPhoto={onDiscardPhoto}
          />
        ) : null}
      </fieldset>
    </div>
  );
}
