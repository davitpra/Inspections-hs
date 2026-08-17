import type { ScheduledInspection } from '@hs/contracts';

import { formatCivilDay, monthName } from '../presentation/dates';
import { ExternalLinkIcon } from './icons';

/**
 * Lo que un inspector cerró, en tabla. La comparten la tarjeta de la pantalla de inicio
 * —que muestra las últimas— y la pantalla del historial completo: son la misma lista con
 * distinto largo, y si se dibujaran distinto el inspector tendría que aprenderla dos veces.
 *
 * La fecha es `completed_at`, que el servidor proyecta desde `inspection.signed_at`: el
 * momento en que se FIRMÓ el recorrido, no en que llegó al servidor. Un envío hecho sin
 * señal puede tardar días en subir, y el mes es lo que identifica la obligación.
 *
 * `—` cuando el período figura completado y la fecha no viene. No es decorativo: pasa
 * cuando el envío existe pero su fila no es visible para quien lee, y ahí lo honesto es
 * dejar el hueco en vez de inventar el día del período.
 */
export function CompletedInspectionsTable({
  inspections,
  siteName,
}: {
  inspections: readonly ScheduledInspection[];
  siteName: (id: string) => string;
}): React.JSX.Element {
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Site</th>
          <th scope="col">Status</th>
          <th scope="col">Completed on</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {inspections.map((item) => (
          <tr key={item.id}>
            <th scope="row">
              {monthName(item.period_start)} {item.period_start.slice(0, 4)}
            </th>
            <td>{siteName(item.site_id)}</td>
            <td>
              <span className="status-pill status-pill--completed">Completed</span>
            </td>
            <td>
              {item.completed_at ? `Completed on ${formatCivilDay(item.completed_at)}` : '—'}
            </td>
            <td>
              {/*
                UN BOTÓN DESHABILITADO Y NO UN LINK, a propósito. Leer una inspección
                enviada todavía no existe: el servidor no devuelve sus respuestas y no hay
                pantalla que las dibuje. Un `<a>` que no navega a ningún lado sería una
                promesa rota; esto dice "todavía no" sin mentir, y el día que el reporte
                exista se cambia por el link acá mismo.
              */}
              <div className="table__actions">
                <button
                  type="button"
                  className="button--outline"
                  disabled
                  title="Reading a submitted inspection is not available yet."
                >
                  View report <ExternalLinkIcon size={16} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
