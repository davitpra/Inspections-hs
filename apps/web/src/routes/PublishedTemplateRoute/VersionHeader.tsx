import type { PublishedTemplateVersion } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { formatDay } from '../../presentation/dates';

/** Identidad del documento congelado y la explicación de por qué solo se puede leer. */
export function VersionHeader({
  version,
}: {
  version: PublishedTemplateVersion;
}): React.JSX.Element {
  return (
    <>
      <Link className="back-link" to="/templates">
        Back to templates
      </Link>
      <header className="published-template__header">
        <p className="published-template__eyebrow">Published template</p>
        <h1>{version.name}</h1>
        <p className="published-template__identity">
          {version.key} · Version {version.version} · published {formatDay(version.published_at)}
        </p>
      </header>
      <div className="notice-card published-template__frozen">
        <div className="notice-card__body">
          <p className="notice-card__text">
            This version is frozen. To correct a published template, publish a new version.
          </p>
        </div>
      </div>
    </>
  );
}
