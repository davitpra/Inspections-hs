import { periodLabel, type CompliancePayload } from '@hs/contracts';

/**
 * Requisitos §3 R5 — EL DOCUMENTO QUE SE LE ENTREGA AL MLITSD.
 *
 * POR QUÉ HTML Y NO UNA LIBRERÍA DE DIBUJO DE PDF (ADR-006, design D5): el documento es
 * tabular, con paginación, encabezado repetido y un pie por página. En HTML eso son cinco
 * reglas de CSS de impresión; en `pdfkit` es cálculo manual de saltos de página, que es
 * trabajo que ya está hecho y bien hecho dentro de un navegador.
 *
 * POR QUÉ EL HTML SE ARMA ACÁ Y NO SE NAVEGA A UNA RUTA DE `apps/web`: un render que
 * navegara al frontend necesitaría una sesión, correría el bundle entero y ataría la
 * generación de evidencia a que el web esté arriba. Este archivo produce una cadena a
 * partir del payload y nada más; no hay red, no hay autenticación y no hay JavaScript.
 *
 * TODO TEXTO DE USUARIO SE ESCAPA. Las descripciones de hallazgo y de acción las escriben
 * personas, y van a parar dentro del HTML que Chromium ejecuta. `escape()` está aplicado
 * en el único lugar por donde el texto entra —`text()`— y no en cada uso, para que no
 * pueda olvidarse en uno.
 *
 * **EL DOCUMENTO NO CALCULA NADA.** Cada número que imprime está en el payload, que es lo
 * que se hasheó. Si esta función sumara, promediara o redondeara algo, el documento diría
 * cosas que su propio digest no cubre.
 */

/** El idioma del documento es inglés, como todo el contenido del sistema. */
export interface DocumentInput {
  payload: CompliancePayload;
  reportId: string;
  payloadHash: string;
}

export function renderComplianceHtml(input: DocumentInput): string {
  const { payload } = input;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Compliance report — ${text(payload.site.name)} — ${text(payload.range.start)} to ${text(payload.range.end)}</title>
<style>${STYLES}</style>
</head>
<body>
${coverSection(input)}
${coverageSection(input)}
${periodsSection(input)}
${findingsSection(input)}
${recurrenceSection(input)}
${actionsSection(input)}
${digestSection(input)}
</body>
</html>`;
}

/**
 * EL PIE, Y VA EN TODAS LAS PÁGINAS.
 *
 * Lo imprime Chromium con `displayHeaderFooter` y sus tokens de página, que es la única
 * forma de tenerlo en las cuatro páginas de un documento de cuatro sin calcular dónde
 * caen los cortes. Una sola vez al final no alcanza: una página suelta, fotocopiada o
 * escaneada, tiene que seguir diciendo de qué documento salió y con qué digest.
 *
 * El tamaño de fuente es explícito y chico porque el default de Chromium para el pie es
 * de otra escala que el cuerpo; sin esto, un digest de 64 caracteres no entra en el
 * ancho de una carta.
 */
export function complianceFooterTemplate(input: DocumentInput): string {
  const { payload } = input;

  return `<div style="width:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:6.5px;color:#333;padding:0 12mm;line-height:1.45;">
  <div style="border-top:0.5px solid #999;padding-top:3px;display:flex;justify-content:space-between;">
    <span>${text(payload.site.name)} &middot; ${text(payload.range.start)} to ${text(payload.range.end)} &middot; generated ${text(payload.generated_at)}</span>
    <span>page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;">
    report ${text(input.reportId)} &middot; payload SHA-256 ${text(input.payloadHash)}
  </div>
</div>`;
}

/** Chromium exige un encabezado cuando `displayHeaderFooter` está activo. Va vacío. */
export const EMPTY_HEADER_TEMPLATE = '<div></div>';

// ---------------------------------------------------------------------------

function coverSection({ payload, reportId, payloadHash }: DocumentInput): string {
  return `<header class="cover">
  <h1>Health &amp; Safety compliance report</h1>
  <p class="site">${text(payload.site.name)}</p>
  <dl class="meta">
    <dt>Period covered</dt><dd>${text(payload.range.start)} to ${text(payload.range.end)}</dd>
    <dt>Generated</dt><dd>${text(payload.generated_at)}</dd>
    <dt>Report</dt><dd class="mono">${text(reportId)}</dd>
    <dt>Payload SHA-256</dt><dd class="mono break">${text(payloadHash)}</dd>
  </dl>
  <p class="notice">
    This report states the inspection coverage recorded for the site over the period above,
    as of the generation date. Figures are frozen at generation and are not recalculated
    when the report is read again.
  </p>
</header>`;
}

/**
 * LA FRACCIÓN, Y NINGÚN PORCENTAJE.
 *
 * §5 riesgo E sacó el scoring de v1 y esto es la misma decisión aplicada al documento: un
 * porcentaje es un número que hay que defender —¿un mes cancelado baja el índice?— y
 * «11 of 12 periods» no necesita defensa, dice exactamente lo que cuenta.
 */
function coverageSection({ payload }: DocumentInput): string {
  const { coverage } = payload;

  return `<section>
  <h2>Coverage</h2>
  <p class="fraction">${coverage.completed_count} of ${coverage.required_count} required periods completed</p>
  <table class="counts">
    <tbody>
      <tr><th>Required</th><td>${coverage.required_count}</td></tr>
      <tr><th>Completed</th><td>${coverage.completed_count}</td></tr>
      <tr><th>Missed</th><td>${coverage.missed_count}</td></tr>
      <tr><th>Cancelled</th><td>${coverage.cancelled_count}</td></tr>
      <tr><th>Still open</th><td>${coverage.open_count}</td></tr>
    </tbody>
  </table>
  <p class="note">
    A period that has not yet ended is reported as still open and is not counted as missed.
  </p>
</section>`;
}

/**
 * EL NOMBRE DEL PERÍODO Y ADEMÁS SUS DOS EXTREMOS, no uno de los dos.
 *
 * Desde 0029 un período puede durar uno, tres, seis o doce meses, así que «2026-01-01» ya
 * no dice cuánto cubre. El nombre lo hace legible —«Q1 2026»— y las fechas exactas
 * debajo son las que defienden el registro: un inspector del MLITSD tiene que poder ver el
 * alcance sin confiar en que quien escribió la etiqueta la calculó bien.
 */
function periodsSection({ payload }: DocumentInput): string {
  const rows = payload.periods
    .map(
      (period) => `<tr class="status-${period.status}">
      <td>
        <strong>${text(periodLabel(period.period_start, period.period_months))}</strong>
        <div class="small">${text(period.period_start)} &ndash; ${text(period.period_end)}</div>
      </td>
      <td class="status">${text(period.status)}</td>
      <td>${period.occurred_at ? text(period.occurred_at) : '&mdash;'}</td>
      <td class="mono small">${period.inspection_id ? text(period.inspection_id) : scheduleNote(period.scheduled_inspection_id)}</td>
      <td>${period.cancellation_reason ? text(period.cancellation_reason) : '&mdash;'}</td>
    </tr>`,
    )
    .join('\n');

  return `<section>
  <h2>Periods</h2>
  <table class="grid">
    <thead>
      <tr><th>Period</th><th>Status</th><th>Inspected on</th><th>Record</th><th>Cancellation reason</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/**
 * El mes que nunca se abrió se dice con palabras y no con una celda vacía.
 *
 * Para el regulador «se planificó y no se hizo» y «nunca se planificó» son los dos un mes
 * sin inspección, y por eso comparten el estado `missed`. Para el empleador son dos
 * problemas distintos —uno es de ejecución y el otro del planificador— y el documento lo
 * dice acá, en el texto, sin inventar un quinto estado.
 */
function scheduleNote(scheduledInspectionId: string | null): string {
  return scheduledInspectionId
    ? `scheduled ${text(scheduledInspectionId)}`
    : 'never scheduled';
}

function findingsSection({ payload }: DocumentInput): string {
  if (payload.findings.length === 0) {
    return `<section><h2>Findings</h2><p class="note">No findings were recorded in this period.</p></section>`;
  }

  const rows = payload.findings
    .map(
      (finding) => `<tr>
      <td>${text(finding.occurred_at)}</td>
      <td>${finding.item_key ? text(finding.item_key) : 'manual entry'}</td>
      <td>${finding.risk_level ? text(finding.risk_level) : 'unclassified'}</td>
      <td>${text(finding.description)}</td>
    </tr>`,
    )
    .join('\n');

  return `<section>
  <h2>Findings</h2>
  <table class="grid">
    <thead><tr><th>Occurred</th><th>Item</th><th>Risk</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/**
 * Las series recurrentes, y el conteo de lo que quedó fuera de todas ellas.
 *
 * El segundo número es el que impide que «no hay series» se lea como «no se repitió
 * nada» cuando puede significar «no había con qué buscarlo»: un hallazgo cargado a mano
 * no tiene concepto estable y queda fuera de toda serie por construcción.
 */
function recurrenceSection({ payload }: DocumentInput): string {
  const rows = payload.recurrence_series
    .map(
      (series) => `<tr>
      <td>${text(series.item_prompt)}</td>
      <td>${series.occurrence_count}</td>
      <td>${text(series.first_occurred_at)}</td>
      <td>${text(series.last_occurred_at)}</td>
      <td>${series.template_version_item_count}</td>
    </tr>`,
    )
    .join('\n');

  const table =
    payload.recurrence_series.length === 0
      ? '<p class="note">No finding repeated within the recurrence window.</p>'
      : `<table class="grid">
    <thead><tr><th>Item</th><th>Occurrences</th><th>First</th><th>Last</th><th>Template versions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return `<section>
  <h2>Recurring findings</h2>
  ${table}
  <p class="note">
    ${payload.excluded_manual_count} finding(s) in this period were entered manually and
    therefore belong to no series: a manually entered finding carries no stable item
    concept to group by.
  </p>
</section>`;
}

function actionsSection({ payload }: DocumentInput): string {
  if (payload.open_actions.length === 0) {
    return `<section><h2>Open corrective actions</h2><p class="note">No corrective action is open.</p></section>`;
  }

  const rows = payload.open_actions
    .map(
      (action) => `<tr class="${action.overdue ? 'overdue' : ''}">
      <td>${text(action.due_at)}</td>
      <td>${text(action.state)}</td>
      <td>${text(action.severity)}</td>
      <td>${action.overdue ? 'overdue' : 'on time'}</td>
      <td>${text(action.description)}</td>
    </tr>`,
    )
    .join('\n');

  return `<section>
  <h2>Open corrective actions</h2>
  <table class="grid">
    <thead><tr><th>Due</th><th>State</th><th>Severity</th><th></th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/**
 * LA SECCIÓN QUE EXPLICA EL DIGEST, y no es un adorno legal.
 *
 * Quien reciba este documento tiene que poder verificarlo sin nuestro código, y tiene que
 * saber que el número NO cubre los bytes del archivo. Sin este párrafo, alguien
 * compararía el SHA-256 del PDF contra el número impreso, no coincidiría, y concluiría lo
 * contrario de lo que pasa.
 */
function digestSection({ payload, payloadHash }: DocumentInput): string {
  return `<section class="digest">
  <h2>Verification</h2>
  <p>
    The SHA-256 digest printed on every page is computed over the <strong>canonical JSON
    payload</strong> of this report — serialised per RFC 8785 (JSON Canonicalization
    Scheme) and encoded as UTF-8 — and <strong>not</strong> over the bytes of this PDF
    file.
  </p>
  <p>
    A PDF produced by a headless browser is not reproducible byte for byte: the browser
    version, the fonts available to it and the creation date it embeds all change the
    file without changing a single word of its content. The payload is reproducible, so
    the digest can be recomputed from it at any later date, by anyone, without this
    system.
  </p>
  <p class="mono break">${text(payloadHash)}</p>
  <p class="note">Payload schema version ${payload.schema_version}.</p>
</section>`;
}

// ---------------------------------------------------------------------------

/**
 * El escapado, en un solo lugar.
 *
 * Cubre los cinco de HTML. El texto que llega acá lo escribieron personas en el campo:
 * la descripción de un hallazgo con un `<` no puede romper la tabla, y una con un
 * `<script>` no puede ejecutarse dentro del navegador que renderiza evidencia.
 */
function text(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Exportado solo para el test que verifica que el escapado no se saltea. */
export const escapeForTest = text;

const STYLES = `
  @page { size: letter; margin: 18mm 12mm 22mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 9.5pt; color: #111; margin: 0; line-height: 1.45;
  }
  h1 { font-size: 17pt; margin: 0 0 2mm; }
  h2 {
    font-size: 11pt; margin: 8mm 0 2mm; padding-bottom: 1mm;
    border-bottom: 1px solid #111;
  }
  .cover { margin-bottom: 6mm; }
  .site { font-size: 13pt; margin: 0 0 4mm; }
  .meta { display: grid; grid-template-columns: 34mm 1fr; gap: 1mm 3mm; margin: 0 0 4mm; }
  .meta dt { font-weight: 600; }
  .meta dd { margin: 0; }
  .fraction { font-size: 13pt; font-weight: 600; margin: 0 0 3mm; }
  .notice, .note { color: #444; font-size: 8.5pt; margin: 2mm 0 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .break { word-break: break-all; }
  .small { font-size: 8pt; }
  table { border-collapse: collapse; width: 100%; }
  .counts th { text-align: left; width: 34mm; font-weight: 600; }
  .counts td, .counts th { padding: 0.8mm 0; }
  .grid th, .grid td {
    border: 0.5px solid #bbb; padding: 1.2mm 1.6mm; text-align: left; vertical-align: top;
  }
  .grid thead th { background: #f0f0f0; font-weight: 600; }
  /* El salto de página no puede partir una fila: media fila en cada página convierte una
     tabla de cumplimiento en un documento discutible. */
  .grid tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .status { text-transform: capitalize; }
  .status-missed .status { font-weight: 700; }
  .overdue td { font-weight: 600; }
  section { page-break-inside: auto; }
  .digest p { margin: 0 0 2mm; }
`;
