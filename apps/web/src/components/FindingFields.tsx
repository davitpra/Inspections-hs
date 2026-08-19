import {
  FINDING_DESCRIPTION_MAX,
  FINDING_DESCRIPTION_MIN,
} from '@hs/contracts';

import type { FindingDraftRow, PhotoRow } from '../offline/db';
import { PhotoField } from './PhotoField';

/**
 * Requisitos §3 R2 — Lo que se le pide al inspector cuando responde que no.
 *
 * Aparece en el mismo lugar donde acaba de contestar y sin ninguna petición de red: la
 * lista de ubicaciones ya está en el dispositivo desde la descarga previa. Pedirle la
 * descripción y la foto más tarde —en una pantalla de repaso, o al firmar— es pedírselas
 * cuando ya caminó los 48 acres y no está más frente a la guarda que falta.
 *
 * La ubicación ya no se pregunta acá: la sección declara la ubicación conceptual y el
 * servidor la resuelve contra el catálogo de la planta. Si no hay mapeo, el hallazgo queda
 * explícitamente sin resolver en vez de inventar un lugar.
 */
export function FindingFields({
  itemKey,
  finding,
  photos,
  disabled,
  onChange,
  onCapturePhoto,
  onDiscardPhoto,
}: {
  itemKey: string;
  finding: FindingDraftRow | undefined;
  photos: PhotoRow[];
  disabled: boolean;
  onChange: (patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>) => void;
  onCapturePhoto: (blob: Blob) => void;
  onDiscardPhoto: (photoId: string) => void;
}): React.JSX.Element {
  const description = finding?.description ?? '';

  return (
    <div className="finding">
      <p className="finding__title">This needs a finding</p>

      <label htmlFor={`finding-description-${itemKey}`}>What is wrong?</label>
      {/*
        El mínimo se DICE mientras se escribe, no al firmar. Es el mismo del contrato y
        el mismo `CHECK` de la migración: descubrirlo en la pantalla de revisión obliga
        al inspector a volver a un ítem que puede estar a media planta de distancia.
      */}
      <p className="finding__hint" id={`finding-description-hint-${itemKey}`}>
        At least {FINDING_DESCRIPTION_MIN} characters — whoever reads this months from
        now was not there.
      </p>
      <textarea
        id={`finding-description-${itemKey}`}
        aria-describedby={`finding-description-hint-${itemKey}`}
        value={description}
        disabled={disabled}
        rows={3}
        minLength={FINDING_DESCRIPTION_MIN}
        maxLength={FINDING_DESCRIPTION_MAX}
        // Se escribe en cada tecla, igual que una respuesta y por el mismo motivo: un
        // debounce es una ventana en la que Android puede matar el proceso.
        onChange={(event) => onChange({ description: event.target.value })}
      />

      {/*
        La foto es obligatoria, y por eso `maxCount` es alto y no hay estado en el que el
        control desaparezca: el tope del contrato son 10, y el mínimo lo exige la
        comprobación previa a firmar.
      */}
      <PhotoField
        id={`finding-photos-${itemKey}`}
        photos={photos}
        maxCount={10}
        label="Photo of the finding"
        onCapture={onCapturePhoto}
        onDiscard={onDiscardPhoto}
      />
    </div>
  );
}
