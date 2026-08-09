import { useEffect, useMemo, useRef } from 'react';

import { photoBlob, type PhotoRow } from '../offline/db';

/**
 * Las fotos de un ítem. Se ven desde el dispositivo, sin red: los bytes están en Dexie
 * desde el momento de la captura y el `blob:` se arma acá.
 *
 * El estado de subida se muestra al lado de cada una. No es decoración: una foto en
 * `pending` es la razón por la que el envío todavía no salió, y el inspector tiene que
 * poder verlo sin abrir la cola.
 */
export function PhotoField({
  id,
  photos,
  maxCount,
  label = 'Take photo',
  onCapture,
  onDiscard,
}: {
  id: string;
  photos: PhotoRow[];
  maxCount: number;
  label?: string;
  onCapture: (blob: Blob) => void;
  onDiscard: (photoId: string) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => photos.map((photo) => ({ photo, url: URL.createObjectURL(photoBlob(photo)) })),
    [photos],
  );

  // Un `blob:` que no se revoca es memoria retenida por el resto de la sesión, y una
  // inspección de tres horas con cinco fotos por ítem las acumula todas.
  useEffect(
    () => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)),
    [previews],
  );

  return (
    <div id={id} className="photos">
      <ul className="photos__list">
        {previews.map(({ photo, url }) => (
          <li key={photo.id} className="photos__item">
            <img src={url} alt="" />
            <span className={`photos__state photos__state--${photo.upload_state}`}>
              {photo.upload_state === 'uploaded' ? 'Uploaded' : 'Not uploaded'}
            </span>
            {photo.upload_state === 'uploaded' ? null : (
              <button type="button" onClick={() => onDiscard(photo.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {photos.length < maxCount ? (
        <>
          <button type="button" onClick={() => input.current?.click()}>
            {label}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            // `capture` abre la cámara directamente en Android, que es el dispositivo
            // de ADR-010 y el único que este sistema tiene que servir bien.
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onCapture(file);
              event.target.value = '';
            }}
          />
        </>
      ) : null}
    </div>
  );
}
