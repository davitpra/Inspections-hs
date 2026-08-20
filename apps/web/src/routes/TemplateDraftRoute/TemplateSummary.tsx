import type {
  DraftIssue,
  Location,
  Site,
  TemplateDraftDocument,
} from "@hs/contracts";

import { BuildingIcon } from "../../components/icons";
import { PublishReadiness } from "./PublishReadiness";
import {
  locationCoverage,
  scopeLabel,
  sectionAppliesTo,
  summaryCounts,
} from "./presentation";

/**
 * El panel de la derecha: la plantilla entera de un vistazo.
 *
 * NO REPITE EL EDITOR, LO RESUME. Un documento de ocho secciones no entra en una pantalla, y
 * las preguntas que el coordinador se hace sobre el conjunto —«¿cuántas preguntas quedaron?»,
 * «¿esta sección va a resolver en las dos plantas?»— no se responden scrolleando. Todo lo de
 * acá es DERIVADO: no hay un solo control, y nada de esto se guarda.
 *
 * El desglose por sección repite el número y el alcance de cada una porque son los dos datos
 * que cambian al mover algo o al tocar el alcance, y verlos juntos es lo que hace evidente
 * que una quedó fuera.
 */
export function TemplateSummary({
  document,
  issues,
  locations,
  sites,
  siteIds,
}: {
  document: TemplateDraftDocument;
  issues: readonly DraftIssue[];
  locations: readonly Location[];
  sites: readonly Site[];
  siteIds: readonly string[];
}): React.JSX.Element {
  const counts = summaryCounts(document, locations, siteIds);

  return (
    <aside className="builder__aside">
      <section className="card">
        <h3>Template summary</h3>

        <p className="field-label">Scope</p>
        <p className="builder__scope-summary">
          <BuildingIcon size={18} /> {scopeLabel(siteIds, sites)}
        </p>

        <dl className="builder__counts">
          <div>
            <dt>Sections</dt>
            <dd>{counts.sections}</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{counts.questions}</dd>
          </div>
          <div>
            <dt>Locations linked</dt>
            <dd>{counts.locationsLinked}</dd>
          </div>
        </dl>

        {document.sections.length > 0 ? (
          <>
            <p className="field-label">Section breakdown</p>
            <ol className="builder__breakdown">
              {document.sections.map((section, index) => (
                // Índice como clave, igual que en el editor: la identidad técnica no forma
                // parte de la interfaz y la lista se recalcula entera en cada tecla.
                <li key={index}>
                  <span className="builder__number" aria-hidden>
                    {index + 1}
                  </span>
                  <div>
                    <p className="builder__breakdown-title">
                      {section.section_title.trim() || `Section ${index + 1}`}
                    </p>
                    <p className="note">
                      {sectionAppliesTo(section, locations, siteIds, sites)}
                    </p>
                    <div className="builder__chips">
                      {[
                        ...locationCoverage(
                          section.organization_location_code,
                          locations,
                          siteIds,
                        ),
                      ]
                        .filter(([, resolved]) => resolved !== undefined)
                        .map(([siteId, resolved]) => (
                          <span key={siteId} className="badge">
                            {sites.find((each) => each.id === siteId)?.name}:{" "}
                            {resolved?.name}
                          </span>
                        ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>

      <PublishReadiness issues={issues} />
    </aside>
  );
}
