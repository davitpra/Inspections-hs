import { z } from 'zod';

import { riskLevelSchema, severitySchema } from './findings.js';
import { actionStateSchema } from './actions.js';
import { recurrenceSeriesSchema } from './reporting.js';

/**
 * Requisitos §3 R5 y §7 etapa 7 — EL REPORTE DE CUMPLIMIENTO ANTE EL MLITSD.
 *
 * R5, textual: «el coordinador consulta, por sitio, la lista de períodos con inspección
 * completada vs. omitida, y exporta a PDF con hash del contenido. Esa es la evidencia de
 * cobertura». Y la métrica número uno de §1 —«cobertura de períodos: 24 de 24»— sale de
 * acá: es `completed_count` sobre `required_count`.
 *
 * LAS DOS COSAS QUE ESTE CONTRATO DEFIENDE, y que no son obvias:
 *
 * 1. **Un período abierto no es un período omitido.** Contar como incumplido un mes que
 *    todavía no terminó es fabricar un incumplimiento en un documento regulatorio. Por
 *    eso `open` es uno de los cuatro estados y no un `missed` con asterisco.
 *
 * 2. **La forma del payload es un contrato de digest.** Lo que se hashea es
 *    `compliancePayloadSchema` canonicalizado según RFC 8785 (ver `canonical-json.ts`),
 *    así que CUALQUIER cambio de esta forma —una clave nueva, una renombrada, un orden
 *    distinto de un array— cambia todos los digests posteriores. Por eso el payload lleva
 *    `schema_version` adentro y por eso subirlo es un acto deliberado y no un efecto
 *    secundario de agregar un campo.
 */

// ---------------------------------------------------------------------------
// Los períodos

/**
 * Los cuatro estados de un período, y ninguno es una opinión.
 *
 *   `completed`  existe la `inspection` de su `scheduled_inspection`
 *   `missed`     el período cerró, no fue cancelado y no hay envío
 *   `cancelled`  la inspección fue cancelada, y el motivo viaja al lado
 *   `open`       el período todavía no cerró — NO cuenta como omitido
 *
 * El borde entre `open` y `missed` se mide en el calendario `America/Toronto`, que es el
 * mismo en el que el trabajo de apertura resuelve el período corriente. En UTC habría
 * cinco horas por mes en las que el reporte declararía un incumplimiento inexistente.
 */
export const PERIOD_STATUSES = ['completed', 'missed', 'cancelled', 'open'] as const;

export const periodStatusSchema = z.enum(PERIOD_STATUSES);

export type PeriodStatus = z.infer<typeof periodStatusSchema>;

/** `YYYY-MM-DD`, que es como viajan las fechas de período: son días, no instantes. */
const dateSchema = z.iso.date();

/**
 * Un período del rango: qué se debía ese mes y qué pasó.
 *
 * **CASI TODO ES NULABLE Y ESO ES EL DISEÑO (D6).** Un período `missed` puede serlo de
 * dos maneras: se planificó y nadie la caminó —trae `scheduled_inspection_id` y
 * `template_version_id`— o el sitio lo debía por su regla y el trabajo de apertura nunca
 * corrió ese mes, y entonces no hay nada que nombrar. La segunda es la que el reporte
 * existe para hacer visible: partir de `scheduled_inspection` habría hecho desaparecer
 * ese mes y `required_count` habría bajado a 11 diciendo «11 de 11» sobre un año al que
 * le faltó un mes.
 */
export const compliancePeriodSchema = z.strictObject({
  period_start: dateSchema,
  period_end: dateSchema,
  status: periodStatusSchema,

  /** Null cuando el sitio debía el período y nunca se abrió. */
  scheduled_inspection_id: z.uuid().nullable(),
  template_id: z.uuid().nullable(),

  /** La versión congelada al planificar, que es contra la que se inspeccionó. */
  template_version_id: z.uuid().nullable(),

  /** Los tres del período cumplido, null en cualquier otro estado. */
  inspection_id: z.uuid().nullable(),
  submitted_by: z.uuid().nullable(),

  /**
   * El reloj del DISPOSITIVO al firmar, no el del servidor al recibir: §5 riesgo C lo
   * fijó como el reloj de cumplimiento. Una inspección caminada el 28 y sincronizada el
   * 4 del mes siguiente cumple el mes en que se caminó.
   */
  occurred_at: z.iso.datetime({ offset: true }).nullable(),

  /** Obligatorio cuando el estado es `cancelled`; null en el resto. */
  cancellation_reason: z.string().nullable(),
});

export type CompliancePeriod = z.infer<typeof compliancePeriodSchema>;

/**
 * La cobertura: la fila «24 de 24» de §1, contada y no estimada.
 *
 * `required_count` es la suma de los otros cuatro por construcción —los cinco salen de
 * las mismas filas y no de consultas aparte—, y el `superRefine` de abajo lo verifica en
 * el borde en vez de confiar en que la consulta no cambie.
 */
export const complianceCoverageSchema = z
  .strictObject({
    required_count: z.number().int().min(0),
    completed_count: z.number().int().min(0),
    missed_count: z.number().int().min(0),
    cancelled_count: z.number().int().min(0),
    open_count: z.number().int().min(0),
  })
  .superRefine((coverage, ctx) => {
    const sum =
      coverage.completed_count +
      coverage.missed_count +
      coverage.cancelled_count +
      coverage.open_count;

    if (sum !== coverage.required_count) {
      ctx.addIssue({
        code: 'custom',
        message: `required_count (${coverage.required_count}) no es la suma de los cuatro estados (${sum})`,
        path: ['required_count'],
      });
    }
  });

export type ComplianceCoverage = z.infer<typeof complianceCoverageSchema>;

// ---------------------------------------------------------------------------
// La consulta

/**
 * El rango, en meses completos.
 *
 * Las dos validaciones tienen el mismo motivo: un reporte de cobertura cuenta MESES, y un
 * rango que empieza el 15 o termina el 20 haría que «12 de 12» se refiriera a algo que no
 * son doce meses. El período es la unidad, así que el rango se expresa en períodos
 * enteros o no se acepta.
 */
export const complianceQuerySchema = z
  .strictObject({
    site_id: z.uuid(),
    range_start: dateSchema,
    range_end: dateSchema,
  })
  .superRefine((query, ctx) => {
    if (!isFirstDayOfMonth(query.range_start)) {
      ctx.addIssue({
        code: 'custom',
        message: 'range_start debe ser el primer día de un mes',
        path: ['range_start'],
      });
    }

    if (!isLastDayOfMonth(query.range_end)) {
      ctx.addIssue({
        code: 'custom',
        message: 'range_end debe ser el último día de un mes',
        path: ['range_end'],
      });
    }

    if (query.range_end < query.range_start) {
      ctx.addIssue({
        code: 'custom',
        message: 'range_end no puede preceder a range_start',
        path: ['range_end'],
      });
    }
  });

export type ComplianceQuery = z.infer<typeof complianceQuerySchema>;

/** `YYYY-MM-DD` en UTC: la fecha ya viene validada por `z.iso.date()`. */
function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isFirstDayOfMonth(value: string): boolean {
  return parseDate(value).getUTCDate() === 1;
}

function isLastDayOfMonth(value: string): boolean {
  const date = parseDate(value);
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}

// ---------------------------------------------------------------------------
// El payload: lo que se congela y lo que se hashea

/**
 * Un hallazgo del rango, reducido a lo que el documento muestra.
 *
 * **Se guarda dentro del payload y no se resuelve al leer.** Un reporte de julio tiene
 * que seguir mostrando la clasificación que el hallazgo tenía en julio; leerlo por
 * `finding_id` a los seis meses mostraría la reclasificación de septiembre debajo del
 * mismo digest, que es exactamente lo que un digest existe para impedir.
 */
export const compliancePayloadFindingSchema = z.strictObject({
  id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  location_id: z.uuid(),

  /** Null en un hallazgo manual, que es lo que lo deja fuera de toda serie. */
  item_key: z.string().nullable(),

  description: z.string(),

  /** Null cuando el hallazgo no está clasificado. El documento lo dice así. */
  risk_level: riskLevelSchema.nullable(),
});

export type CompliancePayloadFinding = z.infer<typeof compliancePayloadFindingSchema>;

/**
 * Una acción correctiva abierta al momento de generar. `state` y `overdue` son derivados
 * —del stream de eventos y del reloj— y por eso quedan congelados acá: recalcularlos al
 * leer haría que el documento se contradijera con su propio hash.
 */
export const compliancePayloadActionSchema = z.strictObject({
  id: z.uuid(),
  finding_id: z.uuid().nullable(),
  description: z.string(),
  severity: severitySchema,
  state: actionStateSchema,
  due_at: z.iso.datetime({ offset: true }),
  overdue: z.boolean(),
});

export type CompliancePayloadAction = z.infer<typeof compliancePayloadActionSchema>;

/**
 * LA VERSIÓN DE LA FORMA DEL PAYLOAD.
 *
 * Se sube A MANO cada vez que cambia cualquier cosa de `compliancePayloadSchema`: una
 * clave nueva, una renombrada, un tipo distinto o un criterio de orden diferente. No es
 * decorativo: el digest se calcula sobre esta estructura, así que dos reportes de rangos
 * idénticos generados a los dos lados de un cambio de forma tienen digests distintos por
 * un motivo que solo este número explica.
 */
export const COMPLIANCE_PAYLOAD_SCHEMA_VERSION = 1;

/**
 * EL DOCUMENTO CONGELADO. Esto es lo que se canonicaliza y se hashea.
 *
 * Todo array de este payload sale ORDENADO DE FORMA DETERMINISTA desde el servidor
 * —períodos por `period_start` ascendente, hallazgos por `occurred_at` descendente,
 * series por `occurrence_count` descendente— porque el orden de un array es dato para
 * RFC 8785: dos payloads con los mismos elementos en distinto orden son dos payloads
 * distintos y dan dos digests distintos.
 *
 * `excluded_manual_count` viaja por el mismo motivo que en el reporte de recurrencia: sin
 * él, cero series se lee como «nada se repitió» cuando puede significar «no había con qué
 * buscarlo».
 */
export const compliancePayloadSchema = z.strictObject({
  schema_version: z.literal(COMPLIANCE_PAYLOAD_SCHEMA_VERSION),

  site: z.strictObject({ id: z.uuid(), name: z.string() }),
  range: z.strictObject({ start: dateSchema, end: dateSchema }),

  /** Cuándo se congeló. Fijo dentro del payload, así que entra al digest. */
  generated_at: z.iso.datetime({ offset: true }),

  coverage: complianceCoverageSchema,
  periods: z.array(compliancePeriodSchema),
  findings: z.array(compliancePayloadFindingSchema),
  recurrence_series: z.array(recurrenceSeriesSchema),
  excluded_manual_count: z.number().int().min(0),
  open_actions: z.array(compliancePayloadActionSchema),
});

export type CompliancePayload = z.infer<typeof compliancePayloadSchema>;

// ---------------------------------------------------------------------------
// El reporte guardado y sus renders

/** 64 hex en minúscula: el mismo dominio que el `CHECK` de la migración. */
export const payloadHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'payload_hash: 64 hex minúscula');

export const RENDER_OUTCOMES = ['succeeded', 'failed'] as const;

export const renderOutcomeSchema = z.enum(RENDER_OUTCOMES);

export type RenderOutcome = z.infer<typeof renderOutcomeSchema>;

/**
 * Un intento de render, y no «el estado del PDF».
 *
 * **No existe `queued`** (D3). Una fila se inserta cuando el intento terminó; un estado
 * intermedio tendría que pasar después a `succeeded`, y `compliance_report_render` no
 * admite `UPDATE`. Que un reporte todavía no tenga PDF se lee de la ausencia de filas, y
 * dónde está el trabajo lo sabe pg-boss, que es de quien es.
 */
export const complianceRenderSchema = z.strictObject({
  id: z.uuid(),
  report_id: z.uuid(),
  outcome: renderOutcomeSchema,

  /** No nulo exactamente cuando `outcome` es `succeeded`; el `CHECK` lo garantiza. */
  object_key: z.string().nullable(),

  /** No nulo exactamente cuando `outcome` es `failed`. */
  error: z.string().nullable(),

  rendered_at: z.iso.datetime({ offset: true }),
});

export type ComplianceRender = z.infer<typeof complianceRenderSchema>;

/**
 * El reporte tal como se lee: el payload guardado, su digest, y el último render exitoso
 * si lo hubo.
 *
 * `latest_render` es NULABLE y un reporte sin render es un estado normal, no un error: el
 * `POST` responde antes de que Chromium haya corrido, y un render que falla deja el
 * reporte intacto con su digest válido. Un reporte sin PDF es un problema operativo; no
 * es una pérdida de evidencia.
 */
export const complianceReportSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  range_start: dateSchema,
  range_end: dateSchema,
  payload: compliancePayloadSchema,
  payload_hash: payloadHashSchema,
  generated_by: z.uuid(),
  generated_at: z.iso.datetime({ offset: true }),
  latest_render: complianceRenderSchema.nullable(),
});

export type ComplianceReport = z.infer<typeof complianceReportSchema>;

/**
 * El listado: sin `payload`, a propósito.
 *
 * El digest y el rango alcanzan para elegir cuál abrir, y arrastrar el documento entero
 * de cada reporte para pintar una lista es traer kilobytes que nadie mira. El payload se
 * lee cuando se abre uno.
 */
export const complianceReportSummarySchema = complianceReportSchema.omit({ payload: true });

export type ComplianceReportSummary = z.infer<typeof complianceReportSummarySchema>;

/**
 * La vista al vuelo: la cobertura del rango sin congelar nada.
 *
 * Es lo que la pantalla muestra antes de que alguien decida generar evidencia, y por eso
 * NO lleva digest: un número que cambia con el próximo envío no es una prueba de nada, y
 * mostrarle un hash a alguien que no generó un reporte invitaría a citarlo.
 */
export const complianceViewSchema = z.strictObject({
  site_id: z.uuid(),
  range_start: dateSchema,
  range_end: dateSchema,
  coverage: complianceCoverageSchema,
  periods: z.array(compliancePeriodSchema),
});

export type ComplianceView = z.infer<typeof complianceViewSchema>;
