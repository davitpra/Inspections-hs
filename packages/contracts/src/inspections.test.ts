import { describe, expect, it } from 'vitest';

import {
  inspectionScheduleSchema,
  inspectorOptionSchema,
  pendingInspectionSchema,
  scheduledInspectionSchema,
} from './inspections.js';
import { templateOptionSchema } from './templates.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const SCHEDULED_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const INSPECTION_ID = '66666666-6666-4666-8666-666666666666';

/** Una inspección programada válida. Cada test la deforma en un solo punto. */
function validScheduled() {
  return {
    id: SCHEDULED_ID,
    site_id: SITE_ID,
    period_start: '2026-08-01',
    period_months: 1,
    period_end: '2026-08-31',
    template_id: TEMPLATE_ID,
    template_name: 'Monthly general workplace inspection',
    template_version_id: VERSION_ID,
    template_version: 2,
    inspector_id: ACCOUNT_ID,
    inspector_name: 'Dana Okafor',
    scheduled_at: '2026-08-01T07:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    status: 'open',
    inspection_id: null,
    completed_at: null,
  };
}

describe('scheduledInspectionSchema', () => {
  it('acepta una inspección programada con su estado y el nombre del asignado', () => {
    expect(scheduledInspectionSchema.safeParse(validScheduled()).success).toBe(true);
  });

  it('acepta la que no tiene inspector: id y nombre nulos a la vez', () => {
    const result = scheduledInspectionSchema.safeParse({
      ...validScheduled(),
      inspector_id: null,
      inspector_name: null,
    });

    expect(result.success).toBe(true);
  });

  // El caso del LEFT JOIN: hay asignado, pero su fila de `person` no es visible para
  // quien lee porque está en la otra planta. La asignación existe; el nombre no.
  it('acepta un asignado sin nombre visible', () => {
    const result = scheduledInspectionSchema.safeParse({
      ...validScheduled(),
      inspector_name: null,
    });

    expect(result.success).toBe(true);
  });

  it('exige el estado', () => {
    const { status: _status, ...withoutStatus } = validScheduled();

    expect(scheduledInspectionSchema.safeParse(withoutStatus).success).toBe(false);
  });

  it('acepta el cierre: el envío y el instante en que se firmó', () => {
    const result = scheduledInspectionSchema.safeParse({
      ...validScheduled(),
      status: 'completed',
      inspection_id: INSPECTION_ID,
      completed_at: '2026-08-29T21:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  /**
   * Nulos, no ausentes. El `LEFT JOIN` produce nulo para todo período sin envío, que es la
   * mayoría; dejarlos opcionales haría que "no vino el campo" y "no está completado" fueran
   * estados distintos del mismo hecho.
   */
  it('exige los dos campos de cierre aunque estén vacíos', () => {
    const { inspection_id: _id, completed_at: _at, ...withoutClosure } = validScheduled();

    expect(scheduledInspectionSchema.safeParse(withoutClosure).success).toBe(false);
  });

  it('rechaza un estado que no es uno de los cuatro', () => {
    const result = scheduledInspectionSchema.safeParse({
      ...validScheduled(),
      status: 'pending',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un período que no arranca el primero del mes', () => {
    const result = scheduledInspectionSchema.safeParse({
      ...validScheduled(),
      period_start: '2026-08-15',
    });

    expect(result.success).toBe(false);
  });
});

describe('inspectionScheduleSchema', () => {
  it('acepta una regla con inspector por defecto y su nombre', () => {
    const result = inspectionScheduleSchema.safeParse({
      id: SCHEDULED_ID,
      site_id: SITE_ID,
      template_id: TEMPLATE_ID,
      template_name: 'Monthly general workplace inspection',
      frequency_months: 1,
      anchor_month: 1,
      default_inspector_id: ACCOUNT_ID,
      default_inspector_name: 'Dana Okafor',
      created_at: '2026-01-01T00:00:00.000Z',
      deactivated_at: null,
    });

    expect(result.success).toBe(true);
  });

  // Es el estado en que la deja el seed, y el que hace que el período nazca sin dueño.
  it('acepta una regla sin inspector por defecto', () => {
    const result = inspectionScheduleSchema.safeParse({
      id: SCHEDULED_ID,
      site_id: SITE_ID,
      template_id: TEMPLATE_ID,
      template_name: 'Monthly general workplace inspection',
      frequency_months: 1,
      anchor_month: 1,
      default_inspector_id: null,
      default_inspector_name: null,
      created_at: '2026-01-01T00:00:00.000Z',
      deactivated_at: null,
    });

    expect(result.success).toBe(true);
  });
});

describe('inspectorOptionSchema', () => {
  it('acepta un candidato con nombre', () => {
    const result = inspectorOptionSchema.safeParse({
      id: ACCOUNT_ID,
      employee_number: 'E-4471',
      first_name: 'Dana',
      last_name: 'Okafor',
    });

    expect(result.success).toBe(true);
  });

  // La cuenta es elegible por `user_site_scope`; el nombre vive en `person`, que está
  // aislada por sitio. Si la persona está en la otra planta, la opción se ofrece igual.
  it('acepta un candidato elegible cuya persona no es visible', () => {
    const result = inspectorOptionSchema.safeParse({
      id: ACCOUNT_ID,
      employee_number: null,
      first_name: null,
      last_name: null,
    });

    expect(result.success).toBe(true);
  });

  // Lo que separa este esquema de `personOptionSchema`, que tiene los mismos campos.
  it('no admite campos de más: el id es de cuenta, no de persona', () => {
    const result = inspectorOptionSchema.safeParse({
      id: ACCOUNT_ID,
      person_id: ACCOUNT_ID,
      employee_number: 'E-4471',
      first_name: 'Dana',
      last_name: 'Okafor',
    });

    expect(result.success).toBe(false);
  });

  it('no lleva correo ni rol', () => {
    const result = inspectorOptionSchema.safeParse({
      id: ACCOUNT_ID,
      employee_number: 'E-4471',
      first_name: 'Dana',
      last_name: 'Okafor',
      email: 'dana@example.com',
      role: 'jhsc_member',
    });

    expect(result.success).toBe(false);
  });
});

describe('pendingInspectionSchema', () => {
  it('acepta las versiones congelada y publicada más alta', () => {
    const result = pendingInspectionSchema.safeParse({
      id: SCHEDULED_ID,
      site_id: SITE_ID,
      period_start: '2026-08-01',
      period_months: 1,
      period_end: '2026-08-31',
      template_name: 'Monthly general workplace inspection',
      template_version_id: VERSION_ID,
      template_version: 2,
      latest_template_version: 3,
      latest_template_version_id: '77777777-7777-4777-8777-777777777777',
      overdue: false,
    });

    expect(result.success).toBe(true);
  });

  it('rechaza una versión publicada cero', () => {
    const result = pendingInspectionSchema.safeParse({
      id: SCHEDULED_ID,
      site_id: SITE_ID,
      period_start: '2026-08-01',
      period_months: 1,
      period_end: '2026-08-31',
      template_name: 'Monthly general workplace inspection',
      template_version_id: VERSION_ID,
      template_version: 2,
      latest_template_version: 0,
      latest_template_version_id: '77777777-7777-4777-8777-777777777777',
      overdue: false,
    });

    expect(result.success).toBe(false);
  });
});

describe('templateOptionSchema', () => {
  it('acepta una plantilla con su versión publicada más alta', () => {
    const result = templateOptionSchema.safeParse({
      id: TEMPLATE_ID,
      key: 'monthly-general-workplace',
      name: 'Monthly general workplace inspection',
      latest_version: 3,
      latest_version_id: VERSION_ID,
      latest_published_at: '2026-08-22 10:00:00+00',
    });

    expect(result.success).toBe(true);
  });

  // No hay "plantilla sin versión" en este contrato: la versión es obligatoria, que es
  // la forma de que una plantilla no publicable no pueda representarse acá.
  it('rechaza una plantilla sin versión', () => {
    const result = templateOptionSchema.safeParse({
      id: TEMPLATE_ID,
      key: 'monthly-general-workplace',
      name: 'Monthly general workplace inspection',
      latest_version: null,
      latest_version_id: null,
      latest_published_at: null,
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una versión cero o negativa', () => {
    const result = templateOptionSchema.safeParse({
      id: TEMPLATE_ID,
      key: 'monthly-general-workplace',
      name: 'Monthly general workplace inspection',
      latest_version: 0,
      latest_version_id: VERSION_ID,
      latest_published_at: '2026-08-22 10:00:00+00',
    });

    expect(result.success).toBe(false);
  });
});
