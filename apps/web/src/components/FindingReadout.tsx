import type { Finding } from '@hs/contracts';

import { photoCountText } from '../presentation/findings';
import { AlertCircleIcon } from './icons';

/**
 * Un hallazgo ya cerrado, leído: lo que la plantilla PRESCRIBIÓ y lo que el inspector
 * OBSERVÓ, en ese orden y sin mezclarse.
 *
 * Vive acá y no en una ruta porque las dos pantallas que leen un envío lo dibujan igual:
 * el reporte completo (`/inspections/$id/report`) y el recorte de hallazgos
 * (`/findings/$id`) son el mismo registro leído con otra pregunta, y el bloque del
 * hallazgo tiene que ser el mismo en las dos. Quien firmó tiene que reconocer su propio
 * recorrido pase por donde pase.
 *
 * Es el mismo dibujo que `FindingFields` durante la captura, a propósito: lo prescrito
 * arriba, en su filete, y debajo el título ámbar con la observación. Ámbar y no rojo por
 * lo mismo que allá — no es un error de quien contestó, es trabajo que se abrió.
 *
 * `correctiveAction` llega como cadena y no como el ítem entero, por la misma razón que
 * en `FindingFields`: este componente no necesita el tipo de respuesta ni el umbral, y no
 * tenerlos hace imposible que mañana alguien lea el prompt desde adentro del bloque.
 */
export function FindingReadout({
  correctiveAction,
  finding,
}: {
  correctiveAction: string | undefined;
  finding: Finding;
}): React.JSX.Element {
  return (
    <div className="finding">
      {/*
        Lo que la plantilla decidió para esta pregunta, tal como se congeló al publicar.
        Va ARRIBA de la observación porque es el criterio contra el que se la lee; abajo
        llegaría cuando quien audita ya se formó una opinión.

        Una pregunta sin prescripción no dibuja nada —ni encabezado ni leyenda—. Un "no
        corrective action defined" convertiría lo que el autor no decidió en una
        afirmación de la plantilla.
      */}
      {correctiveAction ? (
        <div className="finding__prescription">
          <p className="finding__prescription-title">Corrective action</p>
          <p>{correctiveAction}</p>
        </div>
      ) : null}

      {/*
        El hallazgo se lee como se escribió, con su filete y su título ámbar. No es un
        `notice` — un aviso es algo que el sistema dice, y esto es lo que el inspector
        observó.
      */}
      <p className="finding__title">
        <AlertCircleIcon size={16} />
        Finding
      </p>
      <p className="report__finding-text">{finding.description}</p>
      <p className="note">{photoCountText(finding.photo_object_keys.length)}</p>
    </div>
  );
}
