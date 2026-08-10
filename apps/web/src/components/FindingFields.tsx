import type { LocationOption } from '@hs/contracts';

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
 * **La ubicación es una lista cerrada y no hay campo de texto** (§6 pregunta 1). Un
 * `<input>` de texto acá volvería a abrir por la puerta de atrás lo que la lista cerrada
 * existe para cerrar, y la agrupación fina de la recurrencia dejaría de ser posible.
 */
export function FindingFields({
  itemKey,
  finding,
  photos,
  locations,
  disabled,
  onChange,
  onCapturePhoto,
  onDiscardPhoto,
}: {
  itemKey: string;
  finding: FindingDraftRow | undefined;
  photos: PhotoRow[];
  locations: LocationOption[];
  disabled: boolean;
  onChange: (patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>) => void;
  onCapturePhoto: (blob: Blob) => void;
  onDiscardPhoto: (photoId: string) => void;
}): React.JSX.Element {
  const description = finding?.description ?? '';
  const locationId = finding?.location_id ?? '';

  return (
    <div className="finding">
      <p className="finding__title">This needs a finding</p>

      <label htmlFor={`finding-description-${itemKey}`}>What is wrong?</label>
      <textarea
        id={`finding-description-${itemKey}`}
        value={description}
        disabled={disabled}
        rows={3}
        maxLength={2000}
        // Se escribe en cada tecla, igual que una respuesta y por el mismo motivo: un
        // debounce es una ventana en la que Android puede matar el proceso.
        onChange={(event) => onChange({ description: event.target.value })}
      />

      <label htmlFor={`finding-location-${itemKey}`}>Where?</label>
      <select
        id={`finding-location-${itemKey}`}
        value={locationId}
        disabled={disabled}
        onChange={(event) => onChange({ location_id: event.target.value || null })}
      >
        <option value="">Choose a location…</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

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
