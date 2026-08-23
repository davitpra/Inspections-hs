import type { TemplateDocument, TemplateSection } from '@hs/contracts';

import { ItemRow } from './ItemRow';
import { visibilityLabel } from './presentation';

/** Una sección publicada en el orden del documento, con su ubicación compartida si existe. */
export function SectionCard({
  section,
  index,
  items,
  document,
}: {
  section: TemplateSection;
  index: number;
  items: readonly TemplateSection['items'][number][];
  document: TemplateDocument;
}): React.JSX.Element {
  return (
    <section className="card published-template__section" aria-labelledby={`section-${index}-title`}>
      <div className="published-template__section-head">
        <div>
          <p className="published-template__section-number">Section {index + 1}</p>
          <h2 id={`section-${index}-title`}>{section.section_title}</h2>
        </div>
        {section.organization_location_code ? (
          <p className="published-template__location">
            Shared location: <strong>{section.organization_location_code}</strong>
          </p>
        ) : null}
      </div>
      {section.visible_when ? (
        <p className="published-template__condition">
          {visibilityLabel(section.visible_when, document)}
        </p>
      ) : null}
      <ul className="published-template__items">
        {items.map((item, itemIndex) => (
          <ItemRow key={item.item_key} item={item} index={itemIndex} document={document} />
        ))}
      </ul>
    </section>
  );
}
