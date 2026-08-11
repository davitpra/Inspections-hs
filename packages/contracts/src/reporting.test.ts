import { describe, expect, it } from 'vitest';

import {
  RECURRENCE_GROUPINGS,
  RECURRENCE_GROUPING_DEFAULT,
  WINDOW_MONTHS_DEFAULT,
  recurrenceQuerySchema,
  recurrenceReportSchema,
  recurrenceSeriesSchema,
} from './reporting.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const FINDING_A = '55555555-5555-4555-8555-555555555555';
const FINDING_B = '66666666-6666-4666-8666-666666666666';

function validSeries() {
  return {
    site_id: SITE_ID,
    item_key: 'dock.guards',
    item_prompt: 'Are all machine guards in place?',
    location_id: LOCATION_ID,
    location_count: 1,
    occurrence_count: 2,
    template_version_item_count: 2,
    first_occurred_at: '2026-03-10T13:00:00.000Z',
    last_occurred_at: '2026-08-10T13:00:00.000Z',
    finding_ids: [FINDING_B, FINDING_A],
  };
}

describe('recurrenceQuerySchema — la ventana', () => {
  it('acepta el rango completo', () => {
    expect(recurrenceQuerySchema.parse({ window_months: 1 }).window_months).toBe(1);
    expect(recurrenceQuerySchema.parse({ window_months: 60 }).window_months).toBe(60);
  });

  it('rechaza 0 y 61', () => {
    expect(recurrenceQuerySchema.safeParse({ window_months: 0 }).success).toBe(false);
    expect(recurrenceQuerySchema.safeParse({ window_months: 61 }).success).toBe(false);
  });

  it('rechaza lo que no es un entero', () => {
    expect(recurrenceQuerySchema.safeParse({ window_months: 'doce' }).success).toBe(false);
    expect(recurrenceQuerySchema.safeParse({ window_months: 12.5 }).success).toBe(false);
  });

  /** Llega de un query string, donde `12` es la cadena "12". */
  it('coacciona la cadena del query string', () => {
    expect(recurrenceQuerySchema.parse({ window_months: '24' }).window_months).toBe(24);
  });
});

describe('recurrenceQuerySchema — la agrupación', () => {
  it('acepta los dos modos de §6-bis pregunta 11 y solo esos', () => {
    expect(RECURRENCE_GROUPINGS).toEqual(['item_location', 'item']);

    for (const mode of RECURRENCE_GROUPINGS) {
      expect(recurrenceQuerySchema.parse({ group_by: mode }).group_by).toBe(mode);
    }
  });

  it('rechaza agrupar por la fila publicada', () => {
    expect(recurrenceQuerySchema.safeParse({ group_by: 'template_version' }).success).toBe(false);
  });
});

describe('recurrenceQuerySchema — los defaults', () => {
  it('un request sin parámetros trae los dos puestos', () => {
    const parsed = recurrenceQuerySchema.parse({});

    expect(parsed.window_months).toBe(WINDOW_MONTHS_DEFAULT);
    expect(parsed.group_by).toBe(RECURRENCE_GROUPING_DEFAULT);
  });

  /** §6-bis pregunta 11: la vista por defecto es la accionable. */
  it('el modo por defecto es `item_location`', () => {
    expect(RECURRENCE_GROUPING_DEFAULT).toBe('item_location');
  });
});

describe('recurrenceSeriesSchema', () => {
  it('acepta una serie completa', () => {
    expect(recurrenceSeriesSchema.safeParse(validSeries()).success).toBe(true);
  });

  /** Una sola ocurrencia no es un patrón: el mínimo del contrato es 2. */
  it('rechaza una serie de una sola ocurrencia', () => {
    const single = { ...validSeries(), occurrence_count: 1, finding_ids: [FINDING_A] };

    expect(recurrenceSeriesSchema.safeParse(single).success).toBe(false);
  });

  it('acepta `location_id` nulo, que es el modo `item`', () => {
    const systemic = { ...validSeries(), location_id: null, location_count: 2 };

    expect(recurrenceSeriesSchema.safeParse(systemic).success).toBe(true);
  });
});

describe('recurrenceReportSchema', () => {
  it('lleva el conteo de excluidos también cuando es cero', () => {
    const report = {
      window_months: 12,
      group_by: 'item_location',
      excluded_manual_count: 0,
      series: [validSeries()],
    };

    expect(recurrenceReportSchema.parse(report).excluded_manual_count).toBe(0);
  });

  /**
   * Sin este número, una lista vacía se lee como "no hay patrones" cuando puede
   * significar "no hay datos con los que buscarlos" (design D8).
   */
  it('no admite un reporte sin el conteo de excluidos', () => {
    const report = { window_months: 12, group_by: 'item_location', series: [] };

    expect(recurrenceReportSchema.safeParse(report).success).toBe(false);
  });
});
