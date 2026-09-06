import type { TemplateDocument, TemplateItem } from "@hs/contracts";

import { AlertCircleIcon } from "../../components/icons";
import {
  answerSettings,
  findingConfiguration,
  visibilityLabel,
} from "./presentation";

/**
 * Una pregunta publicada: datos de lectura, nunca controles del editor.
 *
 * Su propia ficha y no una fila con filete, como en la recorrida (`.capture__item`) y en la
 * inspección leída de vuelta (`.report__item`). La razón es la misma en las tres: una
 * pregunta que abre una prescripción entera deja de terminar donde una línea divisoria dice
 * que termina, y con cuarenta seguidas ya no se ve dónde empieza la siguiente. El número va
 * en el cuadrado tenue por la razón inversa: entre cuarenta preguntas sirve para nombrar
 * una en voz alta, no para jerarquizarla — el círculo de marca es de la sección.
 */
export function ItemRow({
  item,
  index,
  document,
}: {
  item: TemplateItem;
  index: number;
  document: TemplateDocument;
}): React.JSX.Element {
  const finding = findingConfiguration(item);

  return (
    <li className="published-template__item">
      <div className="published-template__item-number" aria-hidden>
        {index + 1}
      </div>
      <div className="published-template__item-body">
        <div className="published-template__item-head">
          <h3>{item.prompt}</h3>
          {item.required ? <span className="status-pill">Required</span> : null}
        </div>
        <div className="published-template__details">
          <p className="published-template__detail-label">Answer settings</p>
          <ul>
            {answerSettings(item).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {item.visible_when ? (
          <p className="published-template__condition">
            {visibilityLabel(item.visible_when, document)}
          </p>
        ) : null}
        {finding.length > 0 ? (
          <div className="published-template__finding">
            {/*
              El círculo ámbar, que es lo que en esta aplicación significa «falta algo»
              (`.finding__title` en la recorrida). Acá no hay hallazgo todavía: lo que se
              lee es la prescripción que la plantilla dejó escrita para cuando lo haya.
            */}
            <p className="published-template__detail-label published-template__finding-title">
              <AlertCircleIcon size={16} /> Corrective action:
            </p>
            <ul>
              {finding.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}
