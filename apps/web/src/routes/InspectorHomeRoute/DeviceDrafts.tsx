import { Link } from "@tanstack/react-router";

import type { DraftRow as DraftRowData } from "../../offline/db";
import { isDiscardable } from "../../offline/drafts";
import { monthName } from "../../presentation/dates";
import { draftPillClass, statusLabel } from "./presentation";

/**
 * Una tabla de lo que este DISPOSITIVO tiene, dentro de la misma tarjeta que el resto de
 * la pantalla: encabezado, contenido y nada suelto sobre el fondo.
 *
 * Las columnas son las de `CompletedInspectionsTable`, en el mismo orden: el inspector
 * encuentra el mes, el sitio, el estado y la acción en el mismo lugar en las dos tablas.
 * El sitio sale de `site_id`, que el borrador guarda desde que se crea, así que la columna
 * se lee igual sin red; cuando el nombre no se pudo resolver, `siteName` cae al id.
 *
 * La fila se dibuja acá mismo y no en su propio archivo: son cuatro celdas sin estado, sin
 * hooks y sin consulta, y separarlas obligaba a leer dos archivos para entender una tabla
 * que cabe en uno. Se parte el día que la fila tenga vida propia, no antes.
 *
 * Es la misma pieza dos veces —lo que se está trabajando y lo que ya salió— porque la
 * diferencia entre las dos es cuál lista se le pasa y qué dice cuando está vacía, no cómo
 * se dibuja. La ruta decide el orden; acá solo se dibuja.
 *
 * Los borradores NO se filtran por año. No guardan el período —el mes se resuelve contra
 * la lista del servidor y muchas veces no se puede—, así que un filtro escondería trabajo
 * real sin que se entienda por qué.
 */
export function DeviceDrafts({
  title,
  drafts,
  empty,
  periodStart,
  siteName,
  onDiscard,
}: {
  title: string;
  drafts: readonly DraftRowData[];
  /** Qué decir cuando no hay nada. `null` en la lista que solo se monta si hay algo. */
  empty: string | null;
  periodStart: (draft: DraftRowData) => string | null;
  siteName: (id: string) => string;
  onDiscard: (draft: DraftRowData) => void;
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card__head">
        <h3>{title}</h3>
      </div>

      {drafts.length === 0 && empty !== null ? (
        <p className="note">{empty}</p>
      ) : null}

      {/* Sin filas no se dibuja la tabla: encabezados sobre un cuerpo vacío prometen una
          lista que no existe, y la nota de arriba ya dice qué pasa. */}
      {drafts.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Site</th>
              <th scope="col">Status</th>
              <th scope="col">Started</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              // El día en que se empezó y el mes del período, por fila: lo único que el
              // dispositivo sabe con certeza es lo primero (ver `draftPeriodStart`).
              const started = draft.created_at.slice(0, 10);
              const period = periodStart(draft);

              return (
                <tr key={draft.client_submission_id}>
                  <th scope="row">
                    {period === null
                      ? started
                      : `${monthName(period)} ${period.slice(0, 4)}`}
                  </th>
                  <td>{siteName(draft.site_id)}</td>
                  <td>
                    <span className={draftPillClass(draft.status)}>
                      {statusLabel(draft.status)}
                    </span>
                  </td>
                  <td>
                    {period === null
                      ? "Started on this device"
                      : `Started ${started}`}
                  </td>

                  <td>
                    <div className="table__actions">
                      <Link
                        to="/inspections/$id/capture"
                        params={{ id: draft.scheduled_inspection_id }}
                        className="list__action"
                      >
                        {draft.status === "capturing" ? "Resume" : "Open"}
                      </Link>

                      {/*
                        Descartar solo existe en lo que todavía no salió (ADR-001: el envío
                        es el punto de no retorno). Una fila firmada no lo ofrece, y por eso
                        la píldora dice que está esperando para enviarse en vez de callarlo.
                      */}
                      {isDiscardable(draft) ? (
                        <button
                          type="button"
                          // Rojo como el botón que confirma en el diálogo que abre, pero sin
                          // marco y con el peso de `list__action`: es la segunda acción de la
                          // celda, no la que compite con "Resume" por ser el paso siguiente.
                          className="button--danger-quiet"
                          // El nombre accesible distingue una fila de otra: en una tabla de borradores
                          // que solo se diferencian por su fecha, cinco botones "Discard" son cinco
                          // botones idénticos para quien navega por voz o con lector de pantalla.
                          aria-label={`Discard the draft started ${started}`}
                          onClick={() => onDiscard(draft)}
                        >
                          Discard
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
