import type { TemplateItem } from '@hs/forms';

import { FindingFields } from '../../components/FindingFields';
import { ItemInput } from '../../components/ItemInput';
import { RowMenu } from '../../components/RowMenu';
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
 *
 * QUÉ HAY EN EL MENÚ «⋮» Y POR QUÉ HAY UNO SOLO. «Clear answer» es la única acción por
 * ítem que existe de verdad en la captura. Las `ChoiceButtons` ya se deseleccionan al
 * tocar la opción elegida otra vez —«sin contestar» es un estado que el motor distingue de
 * cualquier respuesta—, pero un texto o un número escritos no tienen ese gesto, y borrar el
 * campo a mano deja `''`, que NO es lo mismo que no haber contestado. Esto es lo que
 * devuelve el ítem a «sin contestar» sin importar el tipo.
 */
export function ItemRow({
  item,
  index,
  value,
  invalid,
  negative,
  answerPhotos,
  findingPhotos,
  finding,
  readOnly,
  onFocus,
  onChange,
  onFindingChange,
  onCapturePhoto,
  onDiscardPhoto,
}: {
  item: TemplateItem;
  /** La posición dentro de la sección. Solo se dibuja: el orden lo da el documento. */
  index: number;
  value: unknown;
  invalid: boolean;
  negative: boolean;
  answerPhotos: PhotoRow[];
  findingPhotos: PhotoRow[];
  finding: FindingDraftRow | undefined;
  readOnly: boolean;
  onFocus: () => void;
  onChange: (value: unknown) => void;
  onFindingChange: (patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>) => void;
  onCapturePhoto: (blob: Blob, kind?: 'answer' | 'finding') => void;
  onDiscardPhoto: (photoId: string) => void;
}): React.JSX.Element {
  return (
    <li className="capture__item" onFocus={onFocus}>
      <div className="capture__item-head">
        <span className="capture__item-number" aria-hidden>
          {index + 1}
        </span>

        <label htmlFor={`item-${item.item_key}`}>
          {item.prompt}
          {item.required ? <span className="required-mark" aria-hidden="true"> *</span> : null}
        </label>
      </div>

      {/*
        Fuera del `<fieldset>`: en una inspección aceptada el formulario está apagado, pero
        el menú no ofrece nada que escriba —«Clear answer» ya llega deshabilitado— y
        meterlo adentro lo apagaría por la razón equivocada.
      */}
      <RowMenu
        label={`Actions for question ${index + 1}`}
        actions={[
          {
            label: 'Clear answer',
            disabled: readOnly || value === undefined,
            onSelect: () => onChange(null),
          },
        ]}
      />

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
            correctiveAction={item.finding?.corrective_action}
            finding={finding}
            photos={findingPhotos}
            disabled={readOnly}
            onChange={onFindingChange}
            onCapturePhoto={(blob) => onCapturePhoto(blob, 'finding')}
            onDiscardPhoto={onDiscardPhoto}
          />
        ) : null}
      </fieldset>
    </li>
  );
}
