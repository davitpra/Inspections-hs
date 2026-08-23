import type { DraftIssue } from '@hs/contracts';

import { CheckIcon, InfoIcon } from '../../components/icons';

/**
 * Qué le falta a este borrador para poder publicarse.
 *
 * **SIEMPRE VISIBLE Y NUNCA BLOQUEANTE.** No condiciona el botón de guardar y no es un
 * error: un documento que se está escribiendo está incompleto casi todo el tiempo, y una
 * lista de problemas que impidiera guardar obligaría a terminar una sección antes de poder
 * dejarla a medias. Es una lista de pendientes, no una validación.
 *
 * Los mensajes los produce `draftIssues` en `@hs/forms` —la MISMA función que el servidor
 * corre al leer el borrador—, así que esta pantalla no puede decir que algo está listo y
 * recibir después un rechazo. Es la razón por la que esa función no vive en `apps/web`.
 */
export function PublishReadiness({ issues }: { issues: readonly DraftIssue[] }): React.JSX.Element {
  if (issues.length === 0) {
    return (
      <p className="status-card">
        <CheckIcon size={20} /> Nothing left to fill in. This template is ready to publish.
      </p>
    );
  }

  return (
    <section className="card">
      <div className="card__head">
        <h3>
          <InfoIcon size={20} /> Before this can be published
        </h3>
      </div>

      <ul className="list list--issues">
        {issues.map((issue, index) => (
          // Índice como clave: dos issues pueden compartir `path` y mensaje —dos opciones
          // sin etiqueta en el mismo ítem—, y la lista se recalcula entera en cada tecla.
          <li key={index} className="list__row list__row--stacked">
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
