import type { ScheduledInspection } from "@hs/contracts";
import { Link } from "@tanstack/react-router";

import { formatCivilDay, periodLabel } from "../presentation/dates";
import { ExternalLinkIcon } from "./icons";

/**
 * Lo que un inspector cerró, en tabla. Hoy la dibuja solo la pantalla del historial, y
 * vive en `components/` igual: es la forma en que esta aplicación muestra un período
 * cerrado, y la segunda pantalla que liste lo cerrado tiene que verse igual que esta.
 *
 * Los `data-label` no son decorativos: son lo que la regla de teléfono de `index.css` lee
 * para plegar cada fila a una tarjeta, la misma que usan las agendadas y los borradores
 * del dispositivo. Sin ellos esta tabla sería la única de las tres que en un teléfono se
 * lee como una rejilla de cinco columnas.
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
    <table
      className="table completed-inspections__table"
      aria-label="Completed inspections"
    >
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Inspection</th>
          <th scope="col">Site</th>
          <th scope="col">Completed on</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {inspections.map((item) => (
          <tr key={item.id}>
            <th scope="row" data-label="Month">
              {periodLabel(item.period_start, item.period_months)}
            </th>
            <td data-label="Requirement">
              {/*
                El nombre es el asa al reporte, la misma que ofrece la columna de acciones
                y bajo la misma condición: sin `inspection_id` no hay envío que leer, y ahí
                el nombre se queda en texto en vez de prometer una pantalla vacía.
              */}
              {item.inspection_id ? (
                <Link
                  to="/inspections/$id/report"
                  params={{ id: item.id }}
                  className="table__link"
                >
                  {item.template_name}
                </Link>
              ) : (
                item.template_name
              )}
            </td>
            <td data-label="Site">{siteName(item.site_id)}</td>

            <td data-label="Completed on">
              {item.completed_at ? formatCivilDay(item.completed_at) : "—"}
            </td>
            <td data-label="Status">
              <span className="status-pill status-pill--completed">
                Completed
              </span>
            </td>
            <td data-label="Actions" className="completed-inspections__action">
              {/*
                `inspection_id` no nulo es exactamente "hay un envío que leer", y es lo
                único de esta fila que lo dice sin volver a derivar `status`. Sin él no se
                ofrece nada: un link a un reporte que no existe sería una promesa rota.
              */}
              <div className="table__actions">
                {item.inspection_id ? (
                  <Link
                    to="/inspections/$id/report"
                    params={{ id: item.id }}
                    className="list__action"
                  >
                    View report <ExternalLinkIcon size={16} />
                  </Link>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
