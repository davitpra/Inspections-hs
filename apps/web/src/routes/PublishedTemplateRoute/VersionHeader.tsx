import type { PublishedTemplateVersion } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { formatDay } from '../../presentation/dates';
import { ReviseAction } from './ReviseAction';

/**
 * Identidad del documento congelado y, al otro extremo de la línea, su única acción.
 *
 * Antes esto era un aviso a ancho completo con el botón metido adentro: una caja gris para decir
 * una frase, y una frase que hablaba de publicar cuando el botón abre un borrador. Ahora el
 * encabezado no explica nada por su cuenta —la identidad a la izquierda, la acción a la derecha—
 * y lo que hay que saber viaja pegado al botón, que es donde se decide.
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
      <div className="published-template__top">
        <header className="published-template__header">
          <p className="published-template__eyebrow">Published template</p>
          <h1>{version.name}</h1>
          <p className="published-template__identity">
            {version.key} · Version {version.version} · published {formatDay(version.published_at)}
          </p>
        </header>
        {canRevise ? <ReviseAction templateId={version.template_id} /> : null}
      </div>
    </>
  );
}
