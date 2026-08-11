import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
  type ComplianceCoverage,
  type CompliancePayload,
  type CompliancePayloadAction,
  type CompliancePayloadFinding,
  type CompliancePeriod,
  type ComplianceQuery,
  type ComplianceRender,
  type ComplianceReport,
  type ComplianceReportSummary,
  type ComplianceView,
  type PeriodStatus,
  type RecurrenceSeries,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { JobsService } from '../jobs/jobs.service';
import { RENDER_COMPLIANCE_PDF_JOB } from '../jobs/job-registry';
import { ObjectStorageService, type PresignedDownload } from '../uploads/object-storage';
import {
  COMPLIANCE_EXCLUDED_MANUAL_SQL,
  COMPLIANCE_FINDINGS_SQL,
  COMPLIANCE_OPEN_ACTIONS_SQL,
  COMPLIANCE_PERIODS_SQL,
} from './compliance.sql';
import { complianceForbidden, renderNotAvailable, reportNotFound } from './compliance.errors';
import { digestPayload } from './payload-digest';
import { ReportingService } from './reporting.service';

/**
 * Requisitos §3 R5 y §7 etapa 7 — EL REPORTE DE CUMPLIMIENTO.
 *
 * LO QUE ESTE SERVICIO HACE Y NO PARECE: **congela**. `coverage()` calcula y no escribe;
 * `generate()` calcula UNA VEZ, serializa, hashea y guarda; `getReport()` devuelve lo
 * guardado y no recalcula nada. Esa asimetría es el change entero. Un reporte que
 * recalculara al leer mostraría la inspección de abril que se subió tarde dentro de un
 * documento de mayo, y el digest guardado dejaría de verificar contra su propio payload:
 * «el hash no coincide» sobre un documento correcto, que es el peor fallo posible en la
 * superficie que existe para dar confianza.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor:
 *
 *   - Que una planta no vea la otra → política RLS. El `site_id` que viaja en la consulta
 *     SELECCIONA una planta entre las que la sesión ya puede ver; no es lo que aísla.
 *   - Que generar para una planta fuera del alcance falle → el `WITH CHECK` de la política
 *     sobre `compliance_report`. No hay una comprobación de sitio escrita acá.
 *
 * QUÉ SÍ APLICA, y por qué no puede hacerlo el motor: **generar es del coordinador**. RLS
 * decide QUÉ SITIOS, no QUÉ ROLES. Es el mismo reparto que usan las acciones correctivas
 * y los incidentes.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly db: DbService,
    private readonly reporting: ReportingService,
    private readonly jobs: JobsService,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * La vista al vuelo: la cobertura del rango, sin congelar nada.
   *
   * NO devuelve digest, y esa ausencia es deliberada: un número calculado sobre datos que
   * cambian con el próximo envío no prueba nada, y mostrarlo invitaría a citarlo.
   */
  async coverage(session: SessionScope, query: ComplianceQuery): Promise<ComplianceView> {
    return this.db.withSessionClient(
      session,
      async (client) => {
        const periods = await readPeriods(client, query);

        return {
          site_id: query.site_id,
          range_start: query.range_start,
          range_end: query.range_end,
          coverage: countCoverage(periods),
          periods,
        };
      },
      auditorRead(query),
    );
  }

  /**
   * Congela un reporte: construye el payload, lo hashea y lo guarda.
   *
   * EL ENCOLADO DEL RENDER VA DESPUÉS DEL COMMIT, y no dentro de la transacción. Un
   * trabajo encolado dentro de una transacción que después hace rollback deja a pg-boss
   * intentando renderizar un reporte que no existe; y al revés, si el encolado falla, el
   * reporte y su digest YA ESTÁN GUARDADOS y el PDF se puede pedir de nuevo. El orden
   * elige cuál de los dos fallos se prefiere, y se prefiere el segundo: la evidencia se
   * salva, el archivo se reintenta.
   */
  async generate(session: SessionScope, query: ComplianceQuery): Promise<ComplianceReport> {
    if (session.role !== 'hs_coordinator') {
      throw complianceForbidden('Only the H&S coordinator generates compliance reports');
    }

    const report = await this.db.withSessionClient(session, async (client) => {
      const payload = await this.buildPayload(client, session, query);

      const { rows } = await client.query<StoredReportRow>(
        `INSERT INTO compliance_report
           (site_id, range_start, range_end, payload, payload_hash, generated_by)
         VALUES ($1::uuid, $2::date, $3::date, $4::jsonb, $5, $6::uuid)
         RETURNING id, site_id, range_start, range_end, payload, payload_hash,
                   generated_by, generated_at`,
        [
          query.site_id,
          query.range_start,
          query.range_end,
          JSON.stringify(payload),
          // El digest se calcula sobre el MISMO objeto que se guarda. Calcularlo sobre
          // uno reconstruido después sería calcularlo sobre otra cosa.
          digestPayload(payload),
          session.userId,
        ],
      );

      return toReport(rows[0]!, null);
    });

    await this.jobs.send(RENDER_COMPLIANCE_PDF_JOB, { report_id: report.id });

    return report;
  }

  /** El reporte guardado, tal cual, con su último render exitoso si lo hubo. */
  async getReport(session: SessionScope, id: string): Promise<ComplianceReport> {
    return this.db.withSessionClient(
      session,
      async (client) => {
        const { rows } = await client.query<StoredReportRow>(
          `SELECT id, site_id, range_start, range_end, payload, payload_hash,
                  generated_by, generated_at
             FROM compliance_report WHERE id = $1::uuid`,
          [id],
        );

        const row = rows[0];
        if (!row) throw reportNotFound();

        return toReport(row, await readLatestRender(client, id));
      },
      { resource: 'compliance_report' },
    );
  }

  /** Los reportes de una planta, del más reciente al más viejo. Sin payload. */
  async listReports(session: SessionScope, siteId: string): Promise<ComplianceReportSummary[]> {
    return this.db.withSessionClient(
      session,
      async (client) => {
        const { rows } = await client.query<Omit<StoredReportRow, 'payload'>>(
          `SELECT id, site_id, range_start, range_end, payload_hash, generated_by, generated_at
             FROM compliance_report
            WHERE site_id = $1::uuid
            ORDER BY generated_at DESC`,
          [siteId],
        );

        const summaries: ComplianceReportSummary[] = [];

        for (const row of rows) {
          summaries.push({
            id: row.id,
            site_id: row.site_id,
            range_start: row.range_start,
            range_end: row.range_end,
            payload_hash: row.payload_hash,
            generated_by: row.generated_by,
            generated_at: row.generated_at.toISOString(),
            // El ÚLTIMO render, exitoso o no: la lista tiene que poder mostrar «falló, se
            // puede reintentar» y no solo «todavía no hay archivo».
            latest_render: await readLastRender(client, row.id),
          });
        }

        return summaries;
      },
      { resource: 'compliance_report' },
    );
  }

  /**
   * La URL firmada de descarga del PDF.
   *
   * Dos negativas y las dos son `404`: el reporte que no existe —o que es de otra planta,
   * que desde acá se ve igual— y el reporte cuyo PDF todavía no está. Ninguna de las dos
   * es un error del servidor: la segunda es un estado normal del ciclo de vida.
   */
  async downloadUrl(session: SessionScope, id: string): Promise<PresignedDownload> {
    const objectKey = await this.db.withSessionClient(
      session,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'SELECT id FROM compliance_report WHERE id = $1::uuid',
          [id],
        );

        if (!rows[0]) throw reportNotFound();

        const render = await readLatestRender(client, id);
        if (!render?.object_key) throw renderNotAvailable();

        return render.object_key;
      },
      { resource: 'compliance_report' },
    );

    return this.storage.presignComplianceGet(objectKey);
  }

  /**
   * EL DOCUMENTO. Todo lo que el reporte dice se lee acá, una vez, dentro de la misma
   * transacción: si la cobertura se leyera en una y los hallazgos en otra, el documento
   * podría describir dos instantes distintos y su digest no correspondería a ninguno.
   */
  private async buildPayload(
    client: PoolClient,
    session: SessionScope,
    query: ComplianceQuery,
  ): Promise<CompliancePayload> {
    const periods = await readPeriods(client, query);

    const site = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM site WHERE id = $1::uuid',
      [query.site_id],
    );

    if (!site.rows[0]) throw reportNotFound();

    const findings = await client.query<FindingRow>(COMPLIANCE_FINDINGS_SQL, [
      query.site_id,
      query.range_start,
      query.range_end,
    ]);

    const excluded = await client.query<{ excluded_manual_count: number }>(
      COMPLIANCE_EXCLUDED_MANUAL_SQL,
      [query.site_id, query.range_start, query.range_end],
    );

    // Sin el rango: las acciones abiertas son las de AHORA, no las que se abrieron
    // dentro del rango. Una acción de noviembre sin cerrar sigue siendo parte del estado
    // del sitio aunque el reporte cubra enero a marzo.
    const actions = await client.query<ActionRow>(COMPLIANCE_OPEN_ACTIONS_SQL, [
      query.site_id,
      null,
    ]);

    return {
      schema_version: COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
      site: { id: site.rows[0].id, name: site.rows[0].name },
      range: { start: query.range_start, end: query.range_end },
      // ISO-8601 EXPLÍCITO y no un `Date`: la canonicalización rechaza un `Date` a
      // propósito, para que el digest no dependa de un `toJSON()` implícito.
      generated_at: new Date().toISOString(),
      coverage: countCoverage(periods),
      periods,
      findings: findings.rows.map(toPayloadFinding),
      // Las series salen del servicio de recurrencia YA CONSTRUIDO, con su ventana por
      // defecto, en vez de reimplementar la agrupación acá. Duplicar la consulta de §5
      // riesgo A sería duplicar exactamente el fallo silencioso que ese riesgo describe.
      recurrence_series: await this.seriesFor(session, query),
      excluded_manual_count: excluded.rows[0]?.excluded_manual_count ?? 0,
      open_actions: actions.rows.map(toPayloadAction),
    };
  }

  /**
   * Las series de recurrencia del sitio del reporte.
   *
   * Se filtran por sitio DESPUÉS de pedirlas porque el reporte de recurrencia devuelve
   * las de todo el alcance de la sesión —cada serie trae su `site_id` y nunca mezcla dos
   * plantas—, y un reporte de cumplimiento es de una sola planta.
   */
  private async seriesFor(
    session: SessionScope,
    query: ComplianceQuery,
  ): Promise<RecurrenceSeries[]> {
    const report = await this.reporting.recurrence(session, {
      window_months: 12,
      group_by: 'item_location',
    });

    return report.series.filter((series) => series.site_id === query.site_id);
  }
}

// ---------------------------------------------------------------------------

async function readPeriods(
  client: PoolClient,
  query: ComplianceQuery,
): Promise<CompliancePeriod[]> {
  const { rows } = await client.query<PeriodRow>(COMPLIANCE_PERIODS_SQL, [
    query.site_id,
    query.range_start,
    query.range_end,
    // El reloj real. El parámetro existe para que los tests puedan situarse en el borde
    // de un mes sin mover el reloj del proceso; en producción es siempre `now()`.
    null,
  ]);

  return rows.map(toPeriod);
}

/**
 * Los cinco conteos, DERIVADOS DE LAS MISMAS FILAS que se devuelven.
 *
 * Contarlos con consultas aparte abriría la posibilidad de que `required_count` diga 12
 * mientras la lista trae 11 — y el documento diría «11 de 12» sobre once filas, sin que
 * ninguna de las dos mitades esté visiblemente mal.
 */
function countCoverage(periods: readonly CompliancePeriod[]): ComplianceCoverage {
  const of = (status: PeriodStatus) => periods.filter((period) => period.status === status).length;

  return {
    required_count: periods.length,
    completed_count: of('completed'),
    missed_count: of('missed'),
    cancelled_count: of('cancelled'),
    open_count: of('open'),
  };
}

/** La huella del auditor externo (riesgo I de §5) sobre una lectura de cobertura. */
function auditorRead(query: ComplianceQuery) {
  return {
    resource: 'compliance_coverage',
    identify: () => [{ siteId: query.site_id, id: `${query.range_start}/${query.range_end}` }],
  };
}

async function readLatestRender(
  client: PoolClient,
  reportId: string,
): Promise<ComplianceRender | null> {
  const { rows } = await client.query<RenderRow>(
    `SELECT id, report_id, outcome, object_key, error, rendered_at
       FROM compliance_report_render
      WHERE report_id = $1::uuid AND outcome = 'succeeded'
      ORDER BY rendered_at DESC
      LIMIT 1`,
    [reportId],
  );

  return rows[0] ? toRender(rows[0]) : null;
}

async function readLastRender(
  client: PoolClient,
  reportId: string,
): Promise<ComplianceRender | null> {
  const { rows } = await client.query<RenderRow>(
    `SELECT id, report_id, outcome, object_key, error, rendered_at
       FROM compliance_report_render
      WHERE report_id = $1::uuid
      ORDER BY rendered_at DESC
      LIMIT 1`,
    [reportId],
  );

  return rows[0] ? toRender(rows[0]) : null;
}

interface PeriodRow {
  period_start: Date;
  period_end: Date;
  status: PeriodStatus;
  scheduled_inspection_id: string | null;
  template_id: string | null;
  template_version_id: string | null;
  inspection_id: string | null;
  submitted_by: string | null;
  occurred_at: Date | null;
  cancellation_reason: string | null;
}

interface FindingRow {
  id: string;
  occurred_at: Date;
  location_id: string;
  item_key: string | null;
  description: string;
  risk_level: CompliancePayloadFinding['risk_level'];
}

interface ActionRow {
  id: string;
  finding_id: string | null;
  description: string;
  severity: CompliancePayloadAction['severity'];
  state: CompliancePayloadAction['state'];
  due_at: Date;
  overdue: boolean;
}

interface StoredReportRow {
  id: string;
  site_id: string;
  range_start: string;
  range_end: string;
  payload: CompliancePayload;
  payload_hash: string;
  generated_by: string;
  generated_at: Date;
}

interface RenderRow {
  id: string;
  report_id: string;
  outcome: ComplianceRender['outcome'];
  object_key: string | null;
  error: string | null;
  rendered_at: Date;
}

/** `date` de Postgres llega como cadena `YYYY-MM-DD` con `pg`; se normaliza igual. */
function toDate(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function toPeriod(row: PeriodRow): CompliancePeriod {
  return {
    period_start: toDate(row.period_start),
    period_end: toDate(row.period_end),
    status: row.status,
    scheduled_inspection_id: row.scheduled_inspection_id,
    template_id: row.template_id,
    template_version_id: row.template_version_id,
    inspection_id: row.inspection_id,
    submitted_by: row.submitted_by,
    occurred_at: row.occurred_at?.toISOString() ?? null,
    cancellation_reason: row.cancellation_reason,
  };
}

function toPayloadFinding(row: FindingRow): CompliancePayloadFinding {
  return {
    id: row.id,
    occurred_at: row.occurred_at.toISOString(),
    location_id: row.location_id,
    item_key: row.item_key,
    description: row.description,
    risk_level: row.risk_level,
  };
}

function toPayloadAction(row: ActionRow): CompliancePayloadAction {
  return {
    id: row.id,
    finding_id: row.finding_id,
    description: row.description,
    severity: row.severity,
    state: row.state,
    due_at: row.due_at.toISOString(),
    overdue: row.overdue,
  };
}

function toReport(row: StoredReportRow, render: ComplianceRender | null): ComplianceReport {
  return {
    id: row.id,
    site_id: row.site_id,
    range_start: toDate(row.range_start),
    range_end: toDate(row.range_end),
    payload: row.payload,
    payload_hash: row.payload_hash,
    generated_by: row.generated_by,
    generated_at: row.generated_at.toISOString(),
    latest_render: render,
  };
}

function toRender(row: RenderRow): ComplianceRender {
  return {
    id: row.id,
    report_id: row.report_id,
    outcome: row.outcome,
    object_key: row.object_key,
    error: row.error,
    rendered_at: row.rendered_at.toISOString(),
  };
}
