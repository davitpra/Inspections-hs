import {
  FINDING_DESCRIPTION_MAX,
  FINDING_DESCRIPTION_MIN,
} from "@hs/contracts";

import type { FindingDraftRow, PhotoRow } from "../offline/db";
import { AlertCircleIcon } from "./icons";
import { PhotoField } from "./PhotoField";

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
 *
 * Lo prescrito se MUESTRA, lo observado se ESCRIBE, y no se mezclan. `correctiveAction`
 * es lo que la organización decidió hace meses sobre esta pregunta; la descripción es lo
 * que el inspector vio hoy. Por eso el texto prescrito no prellena el campo ni viaja como
 * `placeholder`: un valor que nadie eligió termina leyéndose como evidencia firmada, que
 * es exactamente el error que corrigió el retiro del nivel de control prescrito.
 *
 * Llega como cadena y no como el ítem entero a propósito. Este componente no necesita el
 * tipo de respuesta ni la config, y no tenerlos hace imposible que mañana alguien lea el
 * prompt o el umbral desde adentro del bloque de hallazgo.
 */
export function FindingFields({
  itemKey,
  correctiveAction,
  finding,
  photos,
  disabled,
  onChange,
  onCapturePhoto,
  onDiscardPhoto,
}: {
  itemKey: string;
  correctiveAction: string | undefined;
  finding: FindingDraftRow | undefined;
  photos: PhotoRow[];
  disabled: boolean;
  onChange: (
    patch: Partial<Pick<FindingDraftRow, "description" | "location_id">>,
  ) => void;
  onCapturePhoto: (blob: Blob) => void;
  onDiscardPhoto: (photoId: string) => void;
}): React.JSX.Element {
  const description = finding?.description ?? "";

  return (
    <div className="finding">
      {/*
        Lo que la plantilla ya decidió para esta pregunta, tal como se congeló al
        publicar. Va ARRIBA del campo porque es contexto para redactar la observación y no
        un comentario sobre ella: abajo llegaría cuando el inspector ya escribió.

        Una pregunta sin prescripción no dibuja nada —ni encabezado ni leyenda—. Un "no
        corrective action defined" convertiría lo que el autor no decidió en una
        afirmación de la plantilla.

        El umbral `fails_when` no se muestra: el motor no lo lee, y enseñarlo durante la
        recorrida presentaría como vigente un valor que el sistema nunca aplica.
      */}
      {correctiveAction ? (
        <div className="finding__prescription">
          <p className="finding__prescription-title">Corrective action</p>
          <p>{correctiveAction}</p>
        </div>
      ) : null}
      {/*
        Ámbar y con ícono: no es un error del inspector —contestar que no es una respuesta
        válida— sino trabajo que se abrió y que hay que completar antes de firmar. Rojo lo
        leería como algo que hizo mal.
      */}
      <p className="finding__title">
        <AlertCircleIcon size={16} />
        This needs a finding
      </p>

      {/*
        El asterisco va FUERA del `<label>`, y no es un detalle de maquetado: el nombre
        accesible de un campo es el texto entero de su etiqueta, y metido adentro el campo
        pasaría a llamarse «What is wrong? *». Se dibuja al lado, `aria-hidden`, porque lo
        que hace obligatorio al campo ya se comprueba antes de firmar.
      */}
      <div className="finding__label">
        <label htmlFor={`finding-description-${itemKey}`}>What is wrong?</label>
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      </div>

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
        El mínimo se DICE mientras se escribe, no al firmar. Es el mismo del contrato y el
        mismo `CHECK` de la migración: descubrirlo en la pantalla de revisión obliga al
        inspector a volver a un ítem que puede estar a media planta de distancia.

        Debajo del campo y no arriba: es la medida de lo que se está escribiendo, y arriba
        se lee como una condición para empezar en vez de como el largo que falta.
      */}
      <p className="finding__hint" id={`finding-description-hint-${itemKey}`}>
        At least {FINDING_DESCRIPTION_MIN} characters — whoever reads this
        months from now was not there.
      </p>

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
