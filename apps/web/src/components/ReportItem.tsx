import type { AnswerValue } from "@hs/contracts";
import type { TemplateItem } from "@hs/forms";

import { answerText } from "../presentation/answers";

/**
 * Una pregunta contestada, leída de vuelta: el número, el enunciado y el valor que quedó.
 *
 * Vive acá por lo mismo que `FindingReadout` y `answerText`: las dos pantallas que leen un
 * envío —el reporte completo (`/inspections/$id/report`) y el recorte de hallazgos
 * (`/findings/$id`)— dibujan la ficha igual, y tienen que seguir dibujándola igual. Es el
 * mismo registro leído con otra pregunta; quien firmó tiene que reconocer su propio
 * recorrido pase por donde pase, y quien audita tiene que poder seguirlo contra el
 * formulario. Dos copias de esta ficha serían la misma inspección contando dos historias.
 *
 * La pregunta a la izquierda y el valor contra el borde derecho, en la misma columna en la
 * que estuvo el control durante la recorrida. Sobre cuarenta preguntas seguidas es lo que
 * deja leer la columna de respuestas de un vistazo en vez de cazarla al final de cada
 * enunciado.
 *
 * LO QUE CUELGA DEBAJO ES DE CADA PANTALLA. El reporte agrega el hallazgo; el recorte
 * agrega además lo que se comprometió. La ficha no sabe qué le cuelgan, y por eso ninguna
 * de las dos pantallas tiene que tocarla para mostrar algo más.
 */
export function ReportItem({
  item,
  index,
  value,
  focusable = false,
  children,
}: {
  item: TemplateItem;
  index: number;
  value: AnswerValue | undefined;
  /**
   * Un paso ejecutado desde adentro devuelve el foco a la ficha al terminar —el control que
   * lo tenía no sobrevive al cambio—, y para recibirlo la ficha tiene que ser enfocable. Solo
   * donde hace falta: las cuarenta fichas de un reporte que no ofrece ningún paso agregarían
   * paradas de tabulación que no llevan a ningún lado.
   */
  focusable?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="report__item" tabIndex={focusable ? -1 : undefined}>
      <span className="report__item-number" aria-hidden>
        {index + 1}
      </span>

      <div className="report__item-body">
        <div className="report__item-line">
          <p className="report__item-prompt">{item.prompt}</p>
          <p
            className={
              value === undefined
                ? "report__answer report__answer--empty"
                : "report__answer"
            }
          >
            {answerText(item, value)}
          </p>
        </div>

        {children}
      </div>
    </li>
  );
}

/**
 * La ficha que contiene a un control, para devolverle el foco cuando el diálogo que ese
 * control abrió se cierra.
 *
 * El selector vive junto al único lugar que escribe la clase; una ruta que lo escribiera
 * por su cuenta quedaría atada a un detalle que no le pertenece.
 *
 * **Se busca desde el evento y el foco vuelve a la FICHA, no al botón.** Hay un botón por
 * acción y otro por hallazgo, así que cuál abrió el diálogo lo sabe el evento y no una
 * ref; y el botón puede no sobrevivir a la invalidación que dispara la propia mutación
 * —crear una acción vuelve a dibujar la lista que lo contenía—, con lo que el foco caería
 * al `body`. La ficha sigue ahí.
 */
export function enclosingReportItem(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(".report__item");
}
