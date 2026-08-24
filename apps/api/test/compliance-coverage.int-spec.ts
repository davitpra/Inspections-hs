import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { COMPLIANCE_PERIODS_SQL } from '../src/reporting/compliance.sql';
import { registerSite } from './helpers/catalog';
import { createAccount, type SeededAccount } from './helpers/identity';
import { inScope, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §3 R5 y §1 — LA COBERTURA DE PERÍODOS.
 *
 * De esta consulta sale la métrica número uno del proyecto, «24 de 24», y por eso lo que
 * se asevera acá son NÚMEROS EXACTOS y no formas. El modo de fallo que importa es el
 * mismo del riesgo A: una consulta de cobertura mal escrita no produce ningún error,
 * devuelve once períodos en vez de doce y el documento dice «11 de 11» sobre un año al
 * que le faltó un mes. Nadie duda de ese documento.
 *
 * El caso que este archivo defiende con más insistencia es el del MES QUE NUNCA SE ABRIÓ:
 * el trabajo de apertura no corrió, no hay fila de `scheduled_inspection`, y aun así el
 * sitio debía esa inspección. Tiene que aparecer, contado y en rojo.
 */

const SITE_FULL_YEAR = 'c0117000-0000-4000-8000-000000000001';
const SITE_STATES = 'c0117000-0000-4000-8000-000000000002';
const SITE_QUARTERLY = 'c0117000-0000-4000-8000-000000000005';
const SITE_RULES = 'c0117000-0000-4000-8000-000000000003';

/** Un instante bien después de 2026: con este reloj, todo 2026 está cerrado. */
const AFTER_2026 = '2027-01-15T12:00:00.000Z';

interface PeriodRow extends Record<string, unknown> {
  period_start: Date;
  period_months: number;
  period_end: Date;
  status: 'completed' | 'missed' | 'cancelled' | 'open';
  scheduled_inspection_id: string | null;
  template_id: string | null;
  template_version_id: string | null;
  inspection_id: string | null;
  submitted_by: string | null;
  occurred_at: Date | null;
  cancellation_reason: string | null;
}

let db: TestDatabase;
let templateId: string;
let versionId: string;
let inspector: SeededAccount;

beforeAll(async () => {
  db = await startTestDatabase();

  await registerSite(db.migrator, SITE_FULL_YEAR, 'cvr-full');
  await registerSite(db.migrator, SITE_STATES, 'cvr-state');
  await registerSite(db.migrator, SITE_QUARTERLY, 'cvr-quarter');
  await registerSite(db.migrator, SITE_RULES, 'cvr-rule');

  templateId = await createTemplate(db.migrator, 'coverage.monthly');
  await registerItems(db.migrator, templateId, ['coverage.guards']);
  versionId = await publishVersion(db.migrator, templateId, 1, {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'coverage.guards',
            prompt: 'Are the guards in place?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  });

  inspector = await createAccount(db.app, {
    role: 'jhsc_member',
    siteIds: [SITE_FULL_YEAR, SITE_STATES, SITE_RULES],
  });
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
// Los datos, escritos por SQL directo: lo que se prueba es la consulta.

/**
 * Una regla de recurrencia con su ventana de vigencia explícita.
 *
 * `created_at` y `deactivated_at` se fijan a mano y no por default porque la ventana de
 * la regla es justamente lo que decide qué meses el sitio debía.
 */
async function createRule(
  siteId: string,
  createdAt: string,
  deactivatedAt: string | null = null,
  frequency: { frequencyMonths?: number; anchorMonth?: number } = {},
): Promise<void> {
  await inScope(
    db.app,
    [siteId],
    `INSERT INTO inspection_schedule
       (site_id, template_id, frequency_months, anchor_month, created_at, deactivated_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [
      siteId,
      templateId,
      frequency.frequencyMonths ?? 1,
      frequency.anchorMonth ?? 1,
      createdAt,
      deactivatedAt,
    ],
  );
}

async function schedule(
  siteId: string,
  periodStart: string,
  options: { cancelledAt?: string; reason?: string; periodMonths?: number } = {},
): Promise<string> {
  const [row] = await inScope<{ id: string }>(
    db.app,
    [siteId],
    `INSERT INTO scheduled_inspection
       (site_id, period_start, period_months, template_id, template_version_id, inspector_id,
        cancelled_at, cancellation_reason)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7::timestamptz, $8)
     RETURNING id`,
    [
      siteId,
      periodStart,
      options.periodMonths ?? 1,
      templateId,
      versionId,
      inspector.accountId,
      options.cancelledAt ?? null,
      options.reason ?? null,
    ],
  );

  return row!.id;
}

/** Un envío, con el reloj del DISPOSITIVO al firmar (§5 riesgo C). */
async function submit(siteId: string, scheduledId: string, signedAt: string): Promise<void> {
  await inScope(
    db.app,
    [siteId],
    `INSERT INTO inspection
       (site_id, scheduled_inspection_id, template_version_id, client_submission_id,
        submitted_by, signed_at, answer_count)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 1)`,
    [siteId, scheduledId, versionId, randomUUID(), inspector.accountId, signedAt],
  );
}

async function coverage(
  siteId: string,
  rangeStart: string,
  rangeEnd: string,
  now: string | null = AFTER_2026,
): Promise<PeriodRow[]> {
  return inScope<PeriodRow>(db.app, [siteId], COMPLIANCE_PERIODS_SQL, [
    siteId,
    rangeStart,
    rangeEnd,
    now,
  ]);
}

function counts(rows: readonly PeriodRow[]) {
  return {
    required: rows.length,
    completed: rows.filter((row) => row.status === 'completed').length,
    missed: rows.filter((row) => row.status === 'missed').length,
    cancelled: rows.filter((row) => row.status === 'cancelled').length,
    open: rows.filter((row) => row.status === 'open').length,
  };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

describe('un año de cobertura', () => {
  beforeAll(async () => {
    // La regla existe desde diciembre de 2025: los doce meses de 2026 se deben.
    await createRule(SITE_FULL_YEAR, '2025-12-01T00:00:00Z');

    for (const month of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const periodStart = `2026-${String(month).padStart(2, '0')}-01`;
      const scheduledId = await schedule(SITE_FULL_YEAR, periodStart);
      await submit(SITE_FULL_YEAR, scheduledId, `2026-${String(month).padStart(2, '0')}-20T14:00:00Z`);
    }

    // ABRIL NO EXISTE COMO FILA. Es el mes en el que el trabajo de apertura no corrió.
  });

  it('devuelve doce períodos y once cumplidos', async () => {
    const rows = await coverage(SITE_FULL_YEAR, '2026-01-01', '2026-12-31');

    expect(counts(rows)).toEqual({ required: 12, completed: 11, missed: 1, cancelled: 0, open: 0 });
  });

  it('cuenta el mes que el trabajo de apertura nunca abrió, y lo dice sin identificadores', async () => {
    // EL TEST CENTRAL DE ESTE ARCHIVO. Si la consulta partiera de `scheduled_inspection`,
    // abril desaparecería, `required_count` sería 11 y el documento diría «11 de 11».
    const rows = await coverage(SITE_FULL_YEAR, '2026-01-01', '2026-12-31');
    const april = rows.find((row) => iso(row.period_start) === '2026-04-01');

    expect(april?.status).toBe('missed');
    expect(april?.scheduled_inspection_id).toBeNull();
    expect(april?.template_version_id).toBeNull();
    expect(april?.inspection_id).toBeNull();
  });

  it('un período cumplido nombra su inspección, su firmante y el reloj del dispositivo', async () => {
    const rows = await coverage(SITE_FULL_YEAR, '2026-01-01', '2026-12-31');
    const january = rows.find((row) => iso(row.period_start) === '2026-01-01');

    expect(january?.status).toBe('completed');
    expect(january?.inspection_id).not.toBeNull();
    expect(january?.submitted_by).toBe(inspector.accountId);
    expect(january?.occurred_at?.toISOString()).toBe('2026-01-20T14:00:00.000Z');
    expect(january?.template_version_id).toBe(versionId);
  });

  it('devuelve los períodos en orden y con el fin de mes derivado', async () => {
    const rows = await coverage(SITE_FULL_YEAR, '2026-01-01', '2026-03-31');

    expect(rows.map((row) => iso(row.period_start))).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(iso(rows[1]!.period_end)).toBe('2026-02-28');
  });
});

describe('los cuatro estados', () => {
  beforeAll(async () => {
    await createRule(SITE_STATES, '2025-12-01T00:00:00Z');

    const january = await schedule(SITE_STATES, '2026-01-01');
    await submit(SITE_STATES, january, '2026-01-20T14:00:00Z');

    await schedule(SITE_STATES, '2026-02-01', {
      cancelledAt: '2026-02-10T12:00:00Z',
      reason: 'plant shutdown',
    });

    await schedule(SITE_STATES, '2026-03-01');

    // Agosto queda para el test del borde horario.
    await schedule(SITE_STATES, '2026-08-01');
  });

  it('un mes cancelado no es ni cumplido ni omitido, y trae su motivo', async () => {
    const rows = await coverage(SITE_STATES, '2026-02-01', '2026-02-28');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.cancellation_reason).toBe('plant shutdown');
    expect(counts(rows)).toEqual({ required: 1, completed: 0, missed: 0, cancelled: 1, open: 0 });
  });

  it('un mes cerrado sin envío es omitido', async () => {
    const rows = await coverage(SITE_STATES, '2026-03-01', '2026-03-31');

    expect(rows[0]!.status).toBe('missed');
  });

  it('el mes corriente está abierto y NO cuenta como omitido', async () => {
    // El mismo período de arriba, mirado desde adentro del propio mes.
    const rows = await coverage(SITE_STATES, '2026-03-01', '2026-03-31', '2026-03-15T12:00:00Z');

    expect(rows[0]!.status).toBe('open');
    expect(counts(rows)).toEqual({ required: 1, completed: 0, missed: 0, cancelled: 0, open: 1 });
  });

  it('el último día del mes sigue abierto en Ontario aunque en UTC ya sea el siguiente', async () => {
    // 2026-09-01T01:00:00Z son las 21:00 del 31 de agosto en `America/Toronto`. Medido en
    // UTC, agosto figuraría como omitido durante cinco horas todos los meses.
    const rows = await coverage(SITE_STATES, '2026-08-01', '2026-08-31', '2026-09-01T01:00:00Z');

    expect(rows[0]!.status).toBe('open');
  });

  it('y pasa a omitido cuando el mes cierra también en Ontario', async () => {
    const rows = await coverage(SITE_STATES, '2026-08-01', '2026-08-31', '2026-09-01T05:00:00Z');

    expect(rows[0]!.status).toBe('missed');
  });
});

describe('la ventana de la regla decide qué se debe', () => {
  beforeAll(async () => {
    // Activada a mediados de mayo, desactivada a mediados de septiembre.
    await createRule(SITE_RULES, '2026-05-10T00:00:00Z', '2026-09-15T00:00:00Z');

    // Y lo que la regla alcanzó a abrir antes de desactivarse.
    await schedule(SITE_RULES, '2026-09-01');
  });

  it('no se debe un período anterior a la regla', async () => {
    const rows = await coverage(SITE_RULES, '2026-01-01', '2026-12-31');

    expect(rows.map((row) => iso(row.period_start))).not.toContain('2026-01-01');
  });

  it('el mes en que la regla se creó ya se debe', async () => {
    const rows = await coverage(SITE_RULES, '2026-01-01', '2026-12-31');

    expect(rows.map((row) => iso(row.period_start))).toContain('2026-05-01');
  });

  it('una regla desactivada deja de hacer deber los meses siguientes', async () => {
    const rows = await coverage(SITE_RULES, '2026-01-01', '2026-12-31');
    const months = rows.map((row) => iso(row.period_start));

    expect(months).not.toContain('2026-11-01');
    expect(months).not.toContain('2026-10-01');
  });

  it('pero lo que ya había abierto sigue reportándose en su propio período', async () => {
    const rows = await coverage(SITE_RULES, '2026-01-01', '2026-12-31');
    const september = rows.find((row) => iso(row.period_start) === '2026-09-01');

    expect(september?.status).toBe('missed');
    expect(september?.scheduled_inspection_id).not.toBeNull();
  });

  it('de mayo a septiembre son cinco períodos y ni uno más', async () => {
    const rows = await coverage(SITE_RULES, '2026-01-01', '2026-12-31');

    expect(rows.map((row) => iso(row.period_start))).toEqual([
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
  });
});

describe('el aislamiento', () => {
  it('una transacción sin el alcance de la planta no ve ningún período de ella', async () => {
    // El `WHERE site_id` de la consulta selecciona; el que aísla es la política. Sin el
    // sitio declarado, `inspection_schedule` no devuelve una sola fila.
    const rows = await inScope<PeriodRow>(db.app, [SITE_STATES], COMPLIANCE_PERIODS_SQL, [
      SITE_FULL_YEAR,
      '2026-01-01',
      '2026-12-31',
      AFTER_2026,
    ]);

    expect(rows).toHaveLength(0);
  });
});

/**
 * EL CASO QUE JUSTIFICA LA MIGRACIÓN 0029.
 *
 * Antes de la frecuencia, una plantilla trimestral era imposible de expresar: el sistema
 * la habría reclamado doce veces al año y este mismo reporte —el que se le entrega al
 * MLITSD— habría declarado ocho incumplimientos que nadie cometió.
 */
describe('un año de cobertura con una regla trimestral', () => {
  beforeAll(async () => {
    // Trimestral anclada en enero, viva desde diciembre de 2025.
    await createRule(SITE_QUARTERLY, '2025-12-01T00:00:00Z', null, {
      frequencyMonths: 3,
      anchorMonth: 1,
    });

    // Tres de los cuatro trimestres inspeccionados; el de octubre no se abrió nunca.
    for (const month of ['01', '04', '07']) {
      const scheduledId = await schedule(SITE_QUARTERLY, `2026-${month}-01`, { periodMonths: 3 });
      await submit(SITE_QUARTERLY, scheduledId, `2026-${month}-20T14:00:00Z`);
    }
  });

  it('debe CUATRO períodos al año, no doce', async () => {
    const rows = await coverage(SITE_QUARTERLY, '2026-01-01', '2026-12-31');

    expect(counts(rows)).toEqual({ required: 4, completed: 3, missed: 1, cancelled: 0, open: 0 });
  });

  it('cada período cubre su trimestre entero', async () => {
    const rows = await coverage(SITE_QUARTERLY, '2026-01-01', '2026-12-31');

    expect(rows.map((row) => iso(row.period_start))).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
    expect(iso(rows[0]!.period_end)).toBe('2026-03-31');
    expect(iso(rows[3]!.period_end)).toBe('2026-12-31');
  });

  it('el trimestre que nunca se abrió se cuenta igual, y sin identificadores', async () => {
    // La misma propiedad que el mes de abril del año mensual: lo que hace visible el
    // período omitido es la REGLA, no la fila que no existe.
    const rows = await coverage(SITE_QUARTERLY, '2026-01-01', '2026-12-31');
    const q4 = rows.find((row) => iso(row.period_start) === '2026-10-01');

    expect(q4?.status).toBe('missed');
    expect(q4?.scheduled_inspection_id).toBeNull();
    expect(q4?.period_months).toBe(3);
  });

  it('los meses de en medio del trimestre no son períodos', async () => {
    const rows = await coverage(SITE_QUARTERLY, '2026-01-01', '2026-12-31');
    const starts = rows.map((row) => iso(row.period_start));

    expect(starts).not.toContain('2026-02-01');
    expect(starts).not.toContain('2026-03-01');
  });
});
