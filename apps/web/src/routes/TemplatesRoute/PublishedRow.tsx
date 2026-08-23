import type { TemplateOption } from '@hs/contracts';

import { formatDay } from '../../presentation/dates';
import { publishedVersionLabel } from './presentation';

/** Una plantilla congelada: referencia, no una entrada que se pueda seguir editando. */
export function PublishedRow({ template }: { template: TemplateOption }): React.JSX.Element {
  return (
    <li className="list__row">
      <div>
        <strong>{template.name}</strong>
        <p className="note">
          {template.key} · {publishedVersionLabel(template.latest_version)} · published{' '}
          {formatDay(template.latest_published_at)}
        </p>
      </div>
    </li>
  );
}
