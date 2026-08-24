import { describe, expect, it } from 'vitest';

import {
  COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
  complianceCoverageSchema,
  compliancePayloadSchema,
  compliancePeriodSchema,
  complianceQuerySchema,
  complianceRenderSchema,
  complianceReportSchema,
  periodLabel,
} from './compliance.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const RENDER_ID = '44444444-4444-4444-8444-444444444444';
const SCHEDULED_ID = '55555555-5555-4555-8555-555555555555';
const INSPECTION_ID = '66666666-6666-4666-8666-666666666666';
const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';
const VERSION_ID = '88888888-8888-4888-8888-888888888888';

const HASH = 'a'.repeat(64);

function validQuery() {
  return { site_id: SITE_ID, range_start: '2026-01-01', range_end: '2026-12-31' };
}

function completedPeriod() {
  return {
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    status: 'completed' as const,
    scheduled_inspection_id: SCHEDULED_ID,
    template_id: TEMPLATE_ID,
    template_version_id: VERSION_ID,
    inspection_id: INSPECTION_ID,
    submitted_by: USER_ID,
    occurred_at: '2026-01-28T14:20:00.000Z',
    cancellation_reason: null,
  };
}

/** El mes que el sitio debía y que el trabajo de apertura nunca abrió (D6). */
function neverOpenedPeriod() {
  return {
    period_start: '2026-04-01',
    period_end: '2026-04-30',
    status: 'missed' as const,
    scheduled_inspection_id: null,
    template_id: null,
    template_version_id: null,
    inspection_id: null,
    submitted_by: null,
    occurred_at: null,
    cancellation_reason: null,
  };
}

describe('complianceQuerySchema', () => {
  it('acepta un rango de meses completos', () => {
    expect(complianceQuerySchema.parse(validQuery())).toEqual(validQuery());
  });

  it('rechaza un range_start que no cae el primer día del mes', () => {
    const result = complianceQuerySchema.safeParse({ ...validQuery(), range_start: '2026-01-15' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['range_start']);
  });

  it('rechaza un range_end que no cae el último día del mes', () => {
    // Un reporte de cobertura cuenta meses: medio mes no es una unidad de cumplimiento.
    expect(complianceQuerySchema.safeParse({ ...validQuery(), range_end: '2026-12-20' }).success)
      .toBe(false);
  });

  it('acepta febrero bisiesto y no bisiesto como último día', () => {
    const bisiesto = { site_id: SITE_ID, range_start: '2028-02-01', range_end: '2028-02-29' };
    const comun = { site_id: SITE_ID, range_start: '2026-02-01', range_end: '2026-02-28' };

    expect(complianceQuerySchema.safeParse(bisiesto).success).toBe(true);
    expect(complianceQuerySchema.safeParse(comun).success).toBe(true);
    expect(
      complianceQuerySchema.safeParse({ ...comun, range_end: '2026-02-27' }).success,
    ).toBe(false);
  });

  it('rechaza un rango invertido', () => {
    const result = complianceQuerySchema.safeParse({
      site_id: SITE_ID,
      range_start: '2026-06-01',
      range_end: '2026-03-31',
    });

    expect(result.success).toBe(false);
  });
});

describe('compliancePeriodSchema', () => {
  it('acepta un período cumplido con toda su procedencia', () => {
    expect(compliancePeriodSchema.parse(completedPeriod())).toEqual(completedPeriod());
  });

  it('acepta un período omitido que nunca se abrió, con todo en null', () => {
    expect(compliancePeriodSchema.parse(neverOpenedPeriod())).toEqual(neverOpenedPeriod());
  });

  it('acepta un período cancelado con su motivo', () => {
    const cancelled = {
      ...completedPeriod(),
      status: 'cancelled' as const,
      inspection_id: null,
      submitted_by: null,
      occurred_at: null,
      cancellation_reason: 'plant shutdown',
    };

    expect(compliancePeriodSchema.parse(cancelled).cancellation_reason).toBe('plant shutdown');
  });

  it('rechaza un estado que no es uno de los cuatro', () => {
    expect(
      compliancePeriodSchema.safeParse({ ...completedPeriod(), status: 'overdue' }).success,
    ).toBe(false);
  });
});

describe('complianceCoverageSchema', () => {
  it('acepta la cobertura de un año con once cumplidos', () => {
    const coverage = {
      required_count: 12,
      completed_count: 11,
      missed_count: 1,
      cancelled_count: 0,
      open_count: 0,
    };

    expect(complianceCoverageSchema.parse(coverage)).toEqual(coverage);
  });

  it('rechaza una cobertura cuyos estados no suman lo exigido', () => {
    // El caso que este chequeo existe para atrapar: un período que se cayó de la
    // clasificación y que dejaría el reporte diciendo "11 de 11" sobre doce meses.
    const result = complianceCoverageSchema.safeParse({
      required_count: 12,
      completed_count: 11,
      missed_count: 0,
      cancelled_count: 0,
      open_count: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['required_count']);
  });
});

describe('compliancePayloadSchema', () => {
  function validPayload() {
    return {
      schema_version: COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
      site: { id: SITE_ID, name: 'St. Thomas' },
      range: { start: '2026-01-01', end: '2026-12-31' },
      generated_at: '2027-01-05T15:00:00.000Z',
      coverage: {
        required_count: 2,
        completed_count: 1,
        missed_count: 1,
        cancelled_count: 0,
        open_count: 0,
      },
      periods: [completedPeriod(), neverOpenedPeriod()],
      findings: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          occurred_at: '2026-01-28T14:20:00.000Z',
          location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          item_key: 'dock.guards',
          description: 'Machine guard missing on line 3',
          risk_level: 'high' as const,
        },
      ],
      recurrence_series: [],
      excluded_manual_count: 0,
      open_actions: [],
    };
  }

  it('acepta el documento completo', () => {
    expect(compliancePayloadSchema.parse(validPayload())).toEqual(validPayload());
  });

  it('acepta las versiones de forma que este contrato sabe leer', () => {
    // La 2 es la vigente; la 1 es la de los reportes congelados antes de 0029, que no
    // llevan `period_months` y que tienen que seguir leyéndose. Un reporte regulatorio se
    // consulta años después de generarse: si el contrato solo aceptara la forma que
    // escribe hoy, el documento de 2026 dejaría de validar en cuanto cambiara el payload.
    for (const version of [1, 2]) {
      expect(
        compliancePayloadSchema.safeParse({ ...validPayload(), schema_version: version }).success,
      ).toBe(true);
    }
  });

  it('rechaza una versión de forma que no conoce', () => {
    // Si esto pasara, el digest se estaría calculando sobre una forma que este código no
    // sabe interpretar.
    expect(
      compliancePayloadSchema.safeParse({ ...validPayload(), schema_version: 3 }).success,
    ).toBe(false);
  });

  it('rechaza una clave que no está en la forma', () => {
    // `strictObject`: una clave de más cambiaría el digest sin que nadie subiera
    // `schema_version`.
    expect(
      compliancePayloadSchema.safeParse({ ...validPayload(), score: 91 }).success,
    ).toBe(false);
  });

  it('acepta un hallazgo manual sin item_key y sin clasificación', () => {
    const base = validPayload();
    const payload = {
      ...base,
      findings: base.findings.map((finding) => ({
        ...finding,
        item_key: null,
        risk_level: null,
      })),
    };

    expect(compliancePayloadSchema.safeParse(payload).success).toBe(true);
  });
});

describe('complianceReportSchema y complianceRenderSchema', () => {
  function validRender() {
    return {
      id: RENDER_ID,
      report_id: REPORT_ID,
      outcome: 'succeeded' as const,
      object_key: 'reports/st-thomas/2026/report.pdf',
      error: null,
      rendered_at: '2027-01-05T15:00:12.000Z',
    };
  }

  it('acepta un render exitoso y uno fallido', () => {
    expect(complianceRenderSchema.parse(validRender())).toEqual(validRender());

    const failed = {
      ...validRender(),
      outcome: 'failed' as const,
      object_key: null,
      error: 'Chromium timed out',
    };

    expect(complianceRenderSchema.parse(failed).error).toBe('Chromium timed out');
  });

  it('rechaza un outcome que no es succeeded ni failed', () => {
    // No hay `queued`: una fila se inserta cuando el intento terminó (D3).
    expect(
      complianceRenderSchema.safeParse({ ...validRender(), outcome: 'queued' }).success,
    ).toBe(false);
  });

  it('rechaza un payload_hash que no es 64 hex en minúscula', () => {
    const base = {
      id: REPORT_ID,
      site_id: SITE_ID,
      range_start: '2026-01-01',
      range_end: '2026-12-31',
      payload: compliancePayloadSchema.parse({
        schema_version: COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
        site: { id: SITE_ID, name: 'St. Thomas' },
        range: { start: '2026-01-01', end: '2026-12-31' },
        generated_at: '2027-01-05T15:00:00.000Z',
        coverage: {
          required_count: 1,
          completed_count: 1,
          missed_count: 0,
          cancelled_count: 0,
          open_count: 0,
        },
        periods: [completedPeriod()],
        findings: [],
        recurrence_series: [],
        excluded_manual_count: 0,
        open_actions: [],
      }),
      payload_hash: HASH,
      generated_by: USER_ID,
      generated_at: '2027-01-05T15:00:00.000Z',
      latest_render: null,
    };

    expect(complianceReportSchema.parse(base).latest_render).toBeNull();
    expect(complianceReportSchema.safeParse({ ...base, payload_hash: 'abc' }).success).toBe(false);
    expect(
      complianceReportSchema.safeParse({ ...base, payload_hash: HASH.toUpperCase() }).success,
    ).toBe(false);
  });
});

/**
 * El nombre de un período. Vive en contracts porque lo escriben las cuatro pantallas Y el
 * PDF regulatorio; estos casos son los que separan una etiqueta correcta de una que miente
 * sobre qué meses cubre la evidencia.
 */
describe('periodLabel', () => {
  it('mensual: el mes y el año', () => {
    expect(periodLabel('2026-08-01', 1)).toBe('August 2026');
    expect(periodLabel('2026-01-01', 1)).toBe('January 2026');
  });

  it('sin largo se lee mensual, que es lo que era antes de 0029', () => {
    expect(periodLabel('2026-08-01')).toBe('August 2026');
  });

  it('trimestral alineado al calendario: Q1 a Q4', () => {
    expect(periodLabel('2026-01-01', 3)).toBe('Q1 2026');
    expect(periodLabel('2026-07-01', 3)).toBe('Q3 2026');
    expect(periodLabel('2026-10-01', 3)).toBe('Q4 2026');
  });

  it('NO llama Q a un trimestre que no cae en el trimestre civil', () => {
    // Anclado en febrero cubre feb-abr, que no es Q1. Decir «Q1» mentiría sobre el
    // alcance de la evidencia en un documento que lee un regulador.
    expect(periodLabel('2026-02-01', 3)).toBe('Feb–Apr 2026');
    expect(periodLabel('2026-06-01', 3)).toBe('Jun–Aug 2026');
  });

  it('un período que cruza el año escribe los dos años', () => {
    expect(periodLabel('2026-11-01', 3)).toBe('Nov 2026–Jan 2027');
    expect(periodLabel('2026-09-01', 12)).toBe('Sep 2026–Aug 2027');
  });

  it('semestral y anual alineados', () => {
    expect(periodLabel('2026-01-01', 6)).toBe('H1 2026');
    expect(periodLabel('2026-07-01', 6)).toBe('H2 2026');
    expect(periodLabel('2026-01-01', 12)).toBe('2026');
  });

  it('semestral desalineado escribe los extremos, no H1', () => {
    expect(periodLabel('2026-03-01', 6)).toBe('Mar–Aug 2026');
  });
});
