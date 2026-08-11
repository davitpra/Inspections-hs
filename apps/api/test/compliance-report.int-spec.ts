import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalize, type ComplianceReport } from '@hs/contracts';
import { createHash } from 'node:crypto';

import { ComplianceService } from '../src/reporting/compliance.service';
import { DbService } from '../src/db/db.service';
import { JobsService } from '../src/jobs/jobs.service';
import { ReportingService } from '../src/reporting/reporting.service';
import { registerSite } from './helpers/catalog';
import { createAccount, type SeededAccount } from './helpers/identity';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §3 R5 y §7 etapa 7 — EL REPORTE CONGELADO Y SU HASH.
 *
 * LA PROPIEDAD QUE ESTE ARCHIVO DEFIENDE ES UNA SOLA Y ESTÁ EN EL TEST «un reporte no
 * cambia cuando cambian los datos»: un reporte de julio tiene que seguir diciendo lo que
 * dijo en julio, para siempre. Si esa aserción falla, el digest impreso en el PDF deja de
 * corresponder al documento que lo lleva impreso, y el síntoma que vería un inspector del
 * MLITSD sería «el hash no coincide» sobre un documento correcto — el peor fallo posible
 * en la superficie que existe para dar confianza.
 *
 * Lo demás son las barreras: quién genera, quién no, qué no se puede editar, qué queda en
 * la cadena de auditoría.
 */

const SITE_A = 'c0117000-1111-4000-8000-000000000001';
const SITE_B = 'c0117000-1111-4000-8000-000000000002';

let db: TestDatabase;
let compliance: ComplianceService;
let dbService: DbService;

let templateId: string;
let versionId: string;

let coordinator: SeededAccount;
let coordinatorB: SeededAccount;
let supervisor: SeededAccount;

/** Un rango cerrado y completo: enero a marzo de 2026, con dos de tres cumplidos. */
const RANGE = { range_start: '2026-01-01', range_end: '2026-03-31' } as const;

function session(account: SeededAccount, role: string, siteIds: readonly string[]) {
  return { userId: account.accountId, role, siteIds };
}

beforeAll(async () => {
  db = await startTestDatabase();

  process.env.DATABASE_URL = db.appUrl;
  process.env.JOBS_ENABLED = 'false';
  // El servicio de almacenamiento se construye en el módulo real; acá no se usa porque
  // ningún test de este archivo descarga un PDF.
  process.env.S3_BUCKET ??= 'test-bucket';
  process.env.S3_ACCESS_KEY_ID ??= 'test';
  process.env.S3_SECRET_ACCESS_KEY ??= 'test';

  dbService = new DbService();
  const jobs = new JobsService();

  compliance = new ComplianceService(
    dbService,
    new ReportingService(dbService),
    jobs,
    // El almacenamiento no participa de ningún test de este archivo: congelar un reporte
    // no toca el bucket, y esa separación es justamente lo que hace que un fallo del
    // render no pueda perder evidencia.
    { presignComplianceGet: async () => ({ url: '', object_key: '', expires_at: '' }) } as never,
  );

  await registerSite(db.migrator, SITE_A, 'rpt-a', 'St. Thomas');
  await registerSite(db.migrator, SITE_B, 'rpt-b', 'Glencoe');

  templateId = await createTemplate(db.migrator, 'rpt.monthly');
  await registerItems(db.migrator, templateId, ['rpt.guards']);
  versionId = await publishVersion(db.migrator, templateId, 1, {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'rpt.guards',
            prompt: 'Are the guards in place?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  });

  coordinator = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });
  coordinatorB = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_B] });
  supervisor = await createAccount(db.app, { role: 'supervisor', siteIds: [SITE_A] });

  await inScope(
    db.app,
    [SITE_A],
    `INSERT INTO inspection_schedule (site_id, template_id, created_at)
     VALUES ($1, $2, '2025-12-01T00:00:00Z')`,
    [SITE_A, templateId],
  );

  // Enero y febrero cumplidos; marzo, no. Dos de tres.
  for (const month of ['01', '02', '03']) {
    const scheduled = one(
      await inScope<{ id: string }>(
        db.app,
        [SITE_A],
        `INSERT INTO scheduled_inspection
           (site_id, period_start, template_id, template_version_id, inspector_id)
         VALUES ($1, $2::date, $3, $4, $5) RETURNING id`,
        [SITE_A, `2026-${month}-01`, templateId, versionId, coordinator.accountId],
      ),
    ).id;

    if (month !== '03') {
      await inScope(
        db.app,
        [SITE_A],
        `INSERT INTO inspection
           (site_id, scheduled_inspection_id, template_version_id, client_submission_id,
            submitted_by, signed_at, answer_count)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 1)`,
        [
          SITE_A,
          scheduled,
          versionId,
          randomUUID(),
          coordinator.accountId,
          `2026-${month}-20T14:00:00Z`,
        ],
      );
    }
  }
}, 180_000);

afterAll(async () => {
  await dbService?.onModuleDestroy();
  await db?.stop();
});

async function generate(): Promise<ComplianceReport> {
  return compliance.generate(session(coordinator, 'hs_coordinator', [SITE_A]), {
    site_id: SITE_A,
    ...RANGE,
  });
}

describe('congelar un reporte', () => {
  it('guarda el payload entero y su digest, y responde antes de que exista el PDF', async () => {
    const report = await generate();

    expect(report.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.payload.coverage).toEqual({
      required_count: 3,
      completed_count: 2,
      missed_count: 1,
      cancelled_count: 0,
      open_count: 0,
    });
    // El render corre después: un reporte recién generado no tiene archivo y eso es un
    // estado normal, no un error.
    expect(report.latest_render).toBeNull();
  });

  it('el digest se puede recomputar desde el payload guardado', async () => {
    const report = await generate();

    const recomputed = createHash('sha256').update(canonicalize(report.payload), 'utf8').digest('hex');

    expect(recomputed).toBe(report.payload_hash);
  });

  it('el payload declara la versión de su forma', async () => {
    const report = await generate();

    expect(report.payload.schema_version).toBe(1);
  });

  it('UN REPORTE NO CAMBIA CUANDO CAMBIAN LOS DATOS', async () => {
    // EL TEST CENTRAL DEL CHANGE. Se genera con marzo omitido, después se sube la
    // inspección de marzo tarde, y el reporte tiene que seguir diciendo 2 de 3 con el
    // mismo digest. Si esto falla, el número impreso en el PDF deja de corresponder al
    // documento que lo lleva impreso.
    const report = await generate();

    const marchScheduled = one(
      await inScope<{ id: string }>(
        db.app,
        [SITE_A],
        `SELECT id FROM scheduled_inspection
          WHERE site_id = $1 AND period_start = '2026-03-01'`,
        [SITE_A],
      ),
    ).id;

    await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO inspection
         (site_id, scheduled_inspection_id, template_version_id, client_submission_id,
          submitted_by, signed_at, answer_count)
       VALUES ($1, $2, $3, $4, $5, '2026-03-28T14:00:00Z', 1)`,
      [SITE_A, marchScheduled, versionId, randomUUID(), coordinator.accountId],
    );

    const reread = await compliance.getReport(
      session(coordinator, 'hs_coordinator', [SITE_A]),
      report.id,
    );

    expect(reread.payload.coverage.completed_count).toBe(2);
    expect(reread.payload.coverage.missed_count).toBe(1);
    expect(reread.payload_hash).toBe(report.payload_hash);

    // Y la vista al vuelo, que NO está congelada, sí refleja el envío tardío. Es la
    // asimetría entera del change en dos aserciones.
    const view = await compliance.coverage(session(coordinator, 'hs_coordinator', [SITE_A]), {
      site_id: SITE_A,
      ...RANGE,
    });

    expect(view.coverage.completed_count).toBe(3);
  });

  it('dos reportes del mismo rango son dos documentos distintos', async () => {
    // El `generated_at` viaja dentro del payload, así que dos generaciones del mismo
    // rango tienen digests distintos. No es un problema: son dos documentos, emitidos en
    // dos momentos, y cada uno verifica contra su propio payload.
    const first = await generate();
    const second = await generate();

    expect(second.id).not.toBe(first.id);
    expect(second.payload_hash).not.toBe(first.payload_hash);
  });
});

describe('quién genera y quién no', () => {
  it('un supervisor no genera, pero lee', async () => {
    await expect(
      compliance.generate(session(supervisor, 'supervisor', [SITE_A]), {
        site_id: SITE_A,
        ...RANGE,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const view = await compliance.coverage(session(supervisor, 'supervisor', [SITE_A]), {
      site_id: SITE_A,
      ...RANGE,
    });

    expect(view.periods).toHaveLength(3);
  });

  it('un coordinador no genera para la planta que no tiene en su alcance', async () => {
    // LO RECHAZA LA POLÍTICA, no una comprobación escrita en el servicio: el `WITH CHECK`
    // de `compliance_report` no deja insertar una fila de una planta no declarada.
    await expect(
      compliance.generate(session(coordinatorB, 'hs_coordinator', [SITE_B]), {
        site_id: SITE_A,
        ...RANGE,
      }),
    ).rejects.toThrow();
  });

  it('un reporte de la otra planta no se puede leer, y se ve como que no existe', async () => {
    const report = await generate();

    await expect(
      compliance.getReport(session(coordinatorB, 'hs_coordinator', [SITE_B]), report.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('la descarga de un reporte sin render exitoso no existe', async () => {
    const report = await generate();

    await expect(
      compliance.downloadUrl(session(coordinator, 'hs_coordinator', [SITE_A]), report.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('la inmutabilidad', () => {
  it('hs_app no puede modificar el payload ni el digest', async () => {
    const report = await generate();

    await expect(
      inScope(db.app, [SITE_A], 'UPDATE compliance_report SET payload_hash = $2 WHERE id = $1', [
        report.id,
        'f'.repeat(64),
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');
  });

  it('el dueño de la tabla tampoco, y ahí lo para el trigger', async () => {
    const report = await generate();

    await expect(
      inScope(db.migrator, [SITE_A], 'UPDATE compliance_report SET payload = $2 WHERE id = $1', [
        report.id,
        '{}',
      ]),
    ).rejects.toThrow();
  });

  it('un reporte no se borra ni se trunca', async () => {
    const report = await generate();

    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM compliance_report WHERE id = $1', [report.id]),
    ).rejects.toThrow();

    await expect(inScope(db.migrator, [SITE_A], 'TRUNCATE compliance_report')).rejects.toThrow();
  });

  it('un render no se corrige después: se supera con otro intento', async () => {
    const report = await generate();
    await recordRender(report.id, 'failed', null, 'Chromium timed out');

    await expect(
      inScope(db.app, [SITE_A], `UPDATE compliance_report_render SET outcome = 'succeeded'`),
    ).rejects.toThrow();

    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM compliance_report_render'),
    ).rejects.toThrow();
  });

  it('un digest que no es SHA-256 no entra', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO compliance_report
           (site_id, range_start, range_end, payload, payload_hash, generated_by)
         VALUES ($1, '2026-01-01', '2026-03-31', '{}'::jsonb, 'abc', $2)`,
        [SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });

  it('un rango que no son meses enteros no entra', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO compliance_report
           (site_id, range_start, range_end, payload, payload_hash, generated_by)
         VALUES ($1, '2026-01-15', '2026-03-31', '{}'::jsonb, $3, $2)`,
        [SITE_A, coordinator.accountId, 'a'.repeat(64)],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });
});

describe('los CHECK del render', () => {
  it('un render exitoso sin archivo no entra', async () => {
    const report = await generate();

    await expect(recordRender(report.id, 'succeeded', null, null)).rejects.toSatisfy(
      (error) => sqlstate(error) === '23514',
    );
  });

  it('un render fallido con archivo tampoco', async () => {
    const report = await generate();

    await expect(
      recordRender(report.id, 'failed', 'some/key.pdf', 'boom'),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });

  it('un render no puede reclamar una planta que no es la de su reporte', async () => {
    const report = await generate();

    await expect(
      inScope(
        db.app,
        [SITE_A, SITE_B],
        `INSERT INTO compliance_report_render (report_id, site_id, outcome, object_key)
         VALUES ($1, $2, 'succeeded', 'k.pdf')`,
        [report.id, SITE_B],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23503');
  });
});

describe('el aislamiento', () => {
  it('una transacción de una planta no ve los reportes de la otra', async () => {
    await generate();

    const rows = await inScope(db.app, [SITE_B], 'SELECT id FROM compliance_report');

    expect(rows).toHaveLength(0);
  });

  it('un INSERT fuera del alcance declarado lo rechaza la política', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_B],
        `INSERT INTO compliance_report
           (site_id, range_start, range_end, payload, payload_hash, generated_by)
         VALUES ($1, '2026-01-01', '2026-03-31', '{}'::jsonb, $3, $2)`,
        [SITE_A, coordinator.accountId, 'a'.repeat(64)],
      ),
    ).rejects.toThrow();
  });
});

describe('la cadena de auditoría', () => {
  it('generar appendea una entrada con el digest y los conteos', async () => {
    const report = await generate();

    const entry = one(
      await inScope<{ payload: Record<string, unknown>; actor_user_id: string }>(
        db.app,
        [SITE_A],
        `SELECT payload, actor_user_id FROM audit_log
          WHERE site_id = $1 AND event_type = 'compliance_report.generated'
            AND payload->>'report_id' = $2`,
        [SITE_A, report.id],
      ),
    );

    // Los conteos de la entrada son los del DOCUMENTO, no los que la base diría hoy: se
    // comparan contra el payload del propio reporte y no contra un número escrito acá.
    expect(entry.payload.payload_hash).toBe(report.payload_hash);
    expect(entry.payload.required_count).toBe(report.payload.coverage.required_count);
    expect(entry.payload.completed_count).toBe(report.payload.coverage.completed_count);
    expect(entry.payload.missed_count).toBe(report.payload.coverage.missed_count);
    expect(entry.actor_user_id).toBe(coordinator.accountId);
  });

  it('un INSERT directo, por fuera del servicio, appendea la entrada igual', async () => {
    // Es lo que hace que la auditoría sea del motor y no de la aplicación.
    const id = one(
      await inScope<{ id: string }>(
        db.app,
        [SITE_A],
        `INSERT INTO compliance_report
           (site_id, range_start, range_end, payload, payload_hash, generated_by)
         VALUES ($1, '2026-01-01', '2026-03-31',
                 '{"coverage":{"required_count":1,"completed_count":1,"missed_count":0,"cancelled_count":0,"open_count":0},"schema_version":1}'::jsonb,
                 $3, $2)
         RETURNING id`,
        [SITE_A, coordinator.accountId, 'c'.repeat(64)],
      ),
    ).id;

    const rows = await inScope(
      db.app,
      [SITE_A],
      `SELECT 1 FROM audit_log
        WHERE event_type = 'compliance_report.generated' AND payload->>'report_id' = $1`,
      [id],
    );

    expect(rows).toHaveLength(1);
  });

  it('un render exitoso appendea su entrada con la key y el mismo digest', async () => {
    const report = await generate();
    await recordRender(report.id, 'succeeded', `${SITE_A}/reports/${report.id}/one.pdf`, null);

    const entry = one(
      await inScope<{ payload: Record<string, unknown> }>(
        db.app,
        [SITE_A],
        `SELECT payload FROM audit_log
          WHERE event_type = 'compliance_report.rendered' AND payload->>'report_id' = $1`,
        [report.id],
      ),
    );

    expect(entry.payload.object_key).toBe(`${SITE_A}/reports/${report.id}/one.pdf`);
    expect(entry.payload.payload_hash).toBe(report.payload_hash);
  });

  it('un render FALLIDO no appendea nada', async () => {
    const report = await generate();
    await recordRender(report.id, 'failed', null, 'Chromium crashed');

    const rows = await inScope(
      db.app,
      [SITE_A],
      `SELECT 1 FROM audit_log
        WHERE event_type = 'compliance_report.rendered' AND payload->>'report_id' = $1`,
      [report.id],
    );

    expect(rows).toHaveLength(0);
  });

  it('dos renders exitosos appendean dos entradas con el mismo digest', async () => {
    const report = await generate();
    await recordRender(report.id, 'succeeded', `${SITE_A}/reports/${report.id}/first.pdf`, null);
    await recordRender(report.id, 'succeeded', `${SITE_A}/reports/${report.id}/second.pdf`, null);

    const rows = await inScope<{ payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT payload FROM audit_log
        WHERE event_type = 'compliance_report.rendered' AND payload->>'report_id' = $1`,
      [report.id],
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.payload.payload_hash))).toEqual(
      new Set([report.payload_hash]),
    );
    expect(new Set(rows.map((row) => row.payload.object_key)).size).toBe(2);
  });

  it('y la cadena del sitio sigue verificando intacta', async () => {
    // `hs_audit_verify_chain` devuelve el PRIMER eslabón roto, o ninguna fila si está
    // intacta. Cero filas es la aserción.
    const broken = await inScope(
      db.app,
      [SITE_A],
      'SELECT * FROM hs_audit_verify_chain($1::uuid)',
      [SITE_A],
    );

    expect(broken).toEqual([]);
  });
});

describe('el listado', () => {
  it('devuelve los reportes sin payload y con su último intento de render', async () => {
    const report = await generate();
    await recordRender(report.id, 'failed', null, 'Chromium timed out');

    const list = await compliance.listReports(
      session(coordinator, 'hs_coordinator', [SITE_A]),
      SITE_A,
    );

    const found = list.find((item) => item.id === report.id);

    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('payload');
    expect(found?.latest_render?.outcome).toBe('failed');
    expect(found?.latest_render?.error).toBe('Chromium timed out');
  });
});

async function recordRender(
  reportId: string,
  outcome: 'succeeded' | 'failed',
  objectKey: string | null,
  error: string | null,
): Promise<void> {
  await inScope(
    db.app,
    [SITE_A],
    `INSERT INTO compliance_report_render (report_id, site_id, outcome, object_key, error)
     VALUES ($1, $2, $3, $4, $5)`,
    [reportId, SITE_A, outcome, objectKey, error],
  );
}

describe('la verificación de punta a punta', () => {
  it('un año completo da 12 de 12, y el digest se recomputa desde AFUERA', async () => {
    // LA PRUEBA DE LA MÉTRICA DE §1, y la de la decisión de ADR-002 al mismo tiempo.
    //
    // El sitio B se siembra con doce de doce, se genera el reporte, y su payload se
    // verifica con `scripts/verify-compliance-digest.mjs`: un script que NO importa nada
    // de este repositorio —ni `@hs/contracts`, ni nuestra `canonicalize`, ni un módulo de
    // la API— y que solo usa Node. Si el digest coincide, la propiedad que ADR-002 quería
    // se sostiene: cualquiera puede recomputar el número impreso en el pie del PDF sin
    // nuestro código. Si dependiera de nuestra librería, no probaría nada.
    await inScope(
      db.app,
      [SITE_B],
      `INSERT INTO inspection_schedule (site_id, template_id, created_at)
       VALUES ($1, $2, '2025-12-01T00:00:00Z')`,
      [SITE_B, templateId],
    );

    for (let month = 1; month <= 12; month += 1) {
      const period = `2026-${String(month).padStart(2, '0')}-01`;

      const scheduled = one(
        await inScope<{ id: string }>(
          db.app,
          [SITE_B],
          `INSERT INTO scheduled_inspection
             (site_id, period_start, template_id, template_version_id, inspector_id)
           VALUES ($1, $2::date, $3, $4, $5) RETURNING id`,
          [SITE_B, period, templateId, versionId, coordinatorB.accountId],
        ),
      ).id;

      await inScope(
        db.app,
        [SITE_B],
        `INSERT INTO inspection
           (site_id, scheduled_inspection_id, template_version_id, client_submission_id,
            submitted_by, signed_at, answer_count)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 1)`,
        [
          SITE_B,
          scheduled,
          versionId,
          randomUUID(),
          coordinatorB.accountId,
          `2026-${String(month).padStart(2, '0')}-20T14:00:00Z`,
        ],
      );
    }

    const report = await compliance.generate(
      session(coordinatorB, 'hs_coordinator', [SITE_B]),
      { site_id: SITE_B, range_start: '2026-01-01', range_end: '2026-12-31' },
    );

    expect(report.payload.coverage.required_count).toBe(12);
    expect(report.payload.coverage.completed_count).toBe(12);
    expect(report.payload.coverage.missed_count).toBe(0);

    const file = join(mkdtempSync(join(tmpdir(), 'hs-compliance-')), 'payload.json');
    writeFileSync(file, JSON.stringify(report.payload), 'utf8');

    const output = execFileSync(
      process.execPath,
      [resolve(__dirname, '../scripts/verify-compliance-digest.mjs'), file, report.payload_hash],
      { encoding: 'utf8' },
    );

    expect(output).toContain(report.payload_hash);
    expect(output).toContain('OK: el digest coincide con el declarado.');
  });

  it('y un payload alterado en un solo carácter deja de verificar', async () => {
    // La otra mitad: si el número siguiera coincidiendo después de tocar un dato, no
    // estaría probando nada.
    const report = await generate();

    // Se altera relativo a lo que el reporte diga, no a un número fijo: escribir «3»
    // podría coincidir con el valor real y el test pasaría sin probar nada.
    const tampered = {
      ...report.payload,
      coverage: {
        ...report.payload.coverage,
        completed_count: report.payload.coverage.completed_count + 1,
      },
    };

    const file = join(mkdtempSync(join(tmpdir(), 'hs-compliance-')), 'tampered.json');
    writeFileSync(file, JSON.stringify(tampered), 'utf8');

    expect(() =>
      execFileSync(
        process.execPath,
        [resolve(__dirname, '../scripts/verify-compliance-digest.mjs'), file, report.payload_hash],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    ).toThrow();
  });
});
