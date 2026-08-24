import type { PublishedTemplateVersion } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { formatDay } from '../../presentation/dates';
import { ReviseAction } from './ReviseAction';

/**
 * Identidad del documento congelado y la explicación de por qué solo se puede leer.
 *
 * El aviso dice que para corregir hay que publicar una versión nueva, y al lado está el botón
 * que lo empieza —para el coordinador y para nadie más—. Que la frase y la acción vayan juntas
 * es el punto: un aviso que nombra un acto sin ofrecerlo deja al lector buscándolo por su
 * cuenta, y no hay dónde encontrarlo.
 */
export function VersionHeader({
  version,
  canRevise,
}: {
  version: PublishedTemplateVersion;
  canRevise: boolean;
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
          {canRevise ? <ReviseAction templateId={version.template_id} /> : null}
        </div>
      </div>
    </>
  );
}
