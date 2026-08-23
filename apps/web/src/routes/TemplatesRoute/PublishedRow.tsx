import type { TemplateOption } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { formatDay } from '../../presentation/dates';
import { publishedVersionLabel } from './presentation';

/** Una plantilla congelada: el nombre abre exactamente la versión que la fila nombra. */
export function PublishedRow({ template }: { template: TemplateOption }): React.JSX.Element {
  return (
    <li className="list__row">
      <div>
        <Link className="published-name" to="/templates/versions/$versionId" params={{ versionId: template.latest_version_id }}>
          {template.name}
        </Link>
        <p className="note">
          {template.key} · {publishedVersionLabel(template.latest_version)} · published{' '}
          {formatDay(template.latest_published_at)}
        </p>
      </div>
    </li>
  );
}
