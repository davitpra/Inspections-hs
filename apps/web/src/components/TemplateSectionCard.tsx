import type { TemplateSection } from '@hs/forms';
import { useState } from 'react';

import { ChevronIcon } from './icons';

/** Una sección de plantilla compartida por la lectura publicada y la captura. */
export function TemplateSectionCard({
  section,
  index,
  appliesTo,
  condition,
  headerAccessory,
  children,
}: {
  section: TemplateSection;
  index: number;
  appliesTo?: string;
  condition?: string;
  headerAccessory?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const label = section.section_title.trim() || `section ${index + 1}`;

  return (
    <section
      className="card published-template__section"
      aria-labelledby={`section-${index}-title`}
    >
      <div className="published-template__section-head">
        <span className="builder__number" aria-hidden>
          {index + 1}
        </span>
        <div className="published-template__section-title">
          <h2 id={`section-${index}-title`}>{section.section_title}</h2>
          {appliesTo === undefined ? null : (
            <p className="note">
              Section applies to: <strong>{appliesTo}</strong>
            </p>
          )}
        </div>
        {headerAccessory}
        <button
          type="button"
          className={open ? 'builder__collapse' : 'builder__collapse is-closed'}
          aria-expanded={open}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <ChevronIcon />
        </button>
      </div>
      {open ? (
        <>
          {condition === undefined ? null : (
            <p className="published-template__condition">{condition}</p>
          )}
          <ul className="published-template__items">{children}</ul>
        </>
      ) : null}
    </section>
  );
}
