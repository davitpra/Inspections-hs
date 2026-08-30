import type { Finding, ScheduledInspection } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { inspectionsWithFindings } from './presentation';

const SITE = '33333333-3333-4333-8333-333333333333';

function scheduled(overrides: Record<string, unknown> = {}): ScheduledInspection {
  return {
    id: 's-1',
    site_id: SITE,
    period_start: '2027-07-01',
    period_months: 1,
    period_end: '2027-07-31',
    template_id: 't-1',
    template_name: 'Monthly general workplace inspection',
    template_version_id: 'v-1',
    template_version: 1,
    inspector_id: '11111111-1111-4111-8111-111111111111',
    inspector_name: 'Marie Tremblay',
    scheduled_at: '2027-07-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'completed',
    inspection_id: 'insp-1',
    completed_at: '2027-07-29T18:00:00.000Z',
    ...overrides,
  } as ScheduledInspection;
}

function finding(overrides: Record<string, unknown> = {}): Finding {
  return {
    id: 'f-1',
    site_id: SITE,
    origin: 'inspection',
    state: 'raised',
    inspection_id: 'insp-1',
    template_version_item_id: 'tvi-1',
    item_key: 'exits.clear',
    location_id: null,
    description: 'The east exit was blocked by pallets.',
    photo_object_keys: [],
    reported_by: '11111111-1111-4111-8111-111111111111',
    occurred_at: '2027-07-29T18:00:00.000Z',
    recorded_at: '2027-07-29T18:05:00.000Z',
    ...overrides,
  } as Finding;
}

describe('inspectionsWithFindings', () => {
  it('conserva la inspección cuyo envío abrió un hallazgo', () => {
    const rows = inspectionsWithFindings([scheduled()], [finding()]);

    expect(rows.map((row) => row.id)).toEqual(['s-1']);
  });

  /** Una inspección limpia se cerró bien; esta pantalla es sobre lo que salió mal. */
  it('esconde la inspección que no dejó ningún hallazgo', () => {
    const rows = inspectionsWithFindings(
      [scheduled({ id: 'clean', inspection_id: 'insp-clean' })],
      [finding()],
    );

    expect(rows).toEqual([]);
  });

  /**
   * El cruce es por `inspection_id` y no por el id de la fila. Si se comparara contra
   * `item.id` este caso pasaría igual por casualidad, así que el hallazgo apunta a un
   * envío cuyo id NO coincide con ninguna fila.
   */
  it('cruza por el envío y no por la inspección programada', () => {
    const rows = inspectionsWithFindings(
      [scheduled({ id: 'insp-9', inspection_id: 'insp-1' })],
      [finding({ inspection_id: 'insp-9' })],
    );

    expect(rows).toEqual([]);
  });

  /** Un hallazgo manual no tiene recorrido que abrir: se reporta y se ve en `/actions`. */
  it('ignora los hallazgos manuales, que no cuelgan de ninguna inspección', () => {
    const rows = inspectionsWithFindings(
      [scheduled()],
      [finding({ id: 'f-manual', origin: 'manual', inspection_id: null, item_key: null })],
    );

    expect(rows).toEqual([]);
  });

  /** Un período cerrado sin envío visible no puede tener hallazgos que leer. */
  it('descarta la fila sin envío, sin preguntarle a los hallazgos', () => {
    const rows = inspectionsWithFindings([scheduled({ inspection_id: null })], [finding()]);

    expect(rows).toEqual([]);
  });

  it('no reordena: respeta el orden que ya trae', () => {
    const rows = inspectionsWithFindings(
      [
        scheduled({ id: 'july', period_start: '2027-07-01', inspection_id: 'insp-july' }),
        scheduled({ id: 'may', period_start: '2027-05-01', inspection_id: 'insp-may' }),
      ],
      [finding({ inspection_id: 'insp-may' }), finding({ id: 'f-2', inspection_id: 'insp-july' })],
    );

    expect(rows.map((row) => row.id)).toEqual(['july', 'may']);
  });
});
