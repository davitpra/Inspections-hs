import type { TemplateDocument, TemplateItem } from '@hs/contracts';

import { findingConfiguration, responseConfiguration, responseTypeLabel, visibilityLabel } from './presentation';

/** Una pregunta publicada: datos de lectura, nunca controles del editor. */
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
        {index + 1}.
      </div>
      <div className="published-template__item-body">
        <div className="published-template__item-head">
          <h3>{item.prompt}</h3>
          {item.required ? <span className="status-pill status-pill--ready">Required</span> : null}
        </div>
        <dl className="published-template__facts">
          <div>
            <dt>Answer type</dt>
            <dd>{responseTypeLabel(item)}</dd>
          </div>
          <div>
            <dt>Item key</dt>
            <dd>{item.item_key}</dd>
          </div>
        </dl>
        <div className="published-template__details">
          <p className="published-template__detail-label">Answer settings</p>
          <ul>
            {responseConfiguration(item).map((line) => (
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
            <p className="published-template__detail-label">Finding prescription</p>
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
