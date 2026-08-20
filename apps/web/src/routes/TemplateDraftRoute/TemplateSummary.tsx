import type {
  DraftIssue,
  Location,
  Site,
  TemplateDraftDocument,
} from "@hs/contracts";

import { BuildingIcon, DocumentIcon, PinIcon } from "../../components/icons";
import { PublishReadiness } from "./PublishReadiness";
import {
  locationCoverage,
  scopeLabel,
  sectionAppliesTo,
  scopeNotice,
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
      <section className="card builder__summary-card">
        <div className="card__head builder__summary-head">
          <div className="builder__summary-heading">
            <DocumentIcon size={22} />
            <div>
              <h3>Template summary</h3>
              <p className="note">Live overview of this draft</p>
            </div>
          </div>
        </div>

        <div className="builder__summary-scope">
          <p className="field-label">Scope</p>
          <p className="builder__scope-summary">
            <BuildingIcon size={18} />
            <strong>{scopeLabel(siteIds, sites)}</strong>
          </p>
          <p className="note builder__scope-note">{scopeNotice(siteIds, sites)}</p>
        </div>

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
            <div className="builder__breakdown-head">
              <p className="field-label">Section breakdown</p>
              <span className="note">{document.sections.length} total</span>
            </div>
            <ol className="builder__breakdown">
              {document.sections.map((section, index) => (
                // Índice como clave, igual que en el editor: la identidad técnica no forma
                // parte de la interfaz y la lista se recalcula entera en cada tecla.
                <li key={index} className="builder__breakdown-item">
                  <span className="builder__number" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="builder__breakdown-content">
                    <p className="builder__breakdown-title">
                      {section.section_title.trim() || `Section ${index + 1}`}
                    </p>
                    <p className="note builder__breakdown-scope">
                      <PinIcon size={15} />
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
        ) : (
          <p className="builder__empty-summary">
            Add a section to see its location coverage here.
          </p>
        )}
      </section>

      <PublishReadiness issues={issues} />
    </aside>
  );
}
