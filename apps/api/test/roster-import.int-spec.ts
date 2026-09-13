import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRoster, applyRosterRows } from '../src/roster/apply-roster';
import { DbService } from '../src/db/db.service';
import { parseRosterCsv } from '../src/roster/parse-roster-csv';
import { registerSite } from './helpers/catalog';
import { createAccount, personById, selectablePeople } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * Requisitos §6 pregunta cerrada 3 — el roster entra por archivo, manual y
 * controlado.
 *
 * Lo que este spec protege es el comportamiento que decide si el importador se usa
 * o se abandona: que una fila mala no descarte el archivo, que cada rechazo diga en
 * qué fila y por qué, y que un export de ADP con un filtro puesto NO dé de baja a
 * las 160 personas que no aparecen.
 */

const SITE_A = '77777777-0000-4000-8000-00000000000a';
const SITE_B = '77777777-0000-4000-8000-00000000000b';
const SITE_C = '77777777-0000-4000-8000-00000000000c';

const APPEND_ONLY = 'HS001';
const INSUFFICIENT_PRIVILEGE = '42501';

let db: TestDatabase;
let coordinator: string;

const HEADER = 'employee_number,first_name,last_name,site_code,status';

/** Un archivo con el encabezado canónico y las filas dadas. */
function file(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

/** Fuerza un fallo al insertar el segundo rechazo, después del desglose y su auditoría. */
function parsedWithLateFailure(employeeNumber: string) {
  const parsed = parseRosterCsv(file(`${employeeNumber},Nueva,Persona,roster-a,active`));
  const rejection = {
    row_number: 3,
    employee_number: `${employeeNumber}-REJECTED`,
    reason: 'forced duplicate rejection',
  };

  parsed.rowsRead = 3;
  parsed.rawByRow.set(3, {
    employee_number: rejection.employee_number,
    first_name: 'Rechazada',
    last_name: 'Duplicada',
    site_code: 'roster-a',
    status: 'active',
  });
  parsed.rejections.push(rejection, { ...rejection });

  return parsed;
}

/** Importa un texto CSV con el alcance de las dos plantas del spec. */
async function importFile(
  text: string,
  options: { filename?: string; siteIds?: readonly string[]; userId?: string | null } = {},
) {
  return applyRoster(
    db.app,
    parseRosterCsv(text),
    {
      siteIds: options.siteIds ?? [SITE_A, SITE_B],
      userId: options.userId === undefined ? coordinator : options.userId,
    },
    { sourceFilename: options.filename ?? 'roster.csv' },
  );
}

/** Una persona por número de empleado, buscada en las dos plantas. */
async function byEmployeeNumber(employeeNumber: string) {
  const rows = await inScope<{ id: string; site_id: string; last_name: string; deactivated_at: Date | null }>(
    db.migrator,
    [SITE_A, SITE_B, SITE_C],
    'SELECT id, site_id, last_name, deactivated_at FROM person WHERE employee_number = $1',
    [employeeNumber],
  );

  return rows[0] ?? null;
}

beforeAll(async () => {
  db = await startTestDatabase();

  await registerSite(db.migrator, SITE_A, 'roster-a', 'Roster A');
  await registerSite(db.migrator, SITE_B, 'roster-b', 'Roster B');
  // Una tercera planta que el importador NO administra: es lo que permite probar
  // que un `site_code` real pero fuera del alcance se rechaza igual que uno falso.
  await registerSite(db.migrator, SITE_C, 'roster-c', 'Roster C');

  coordinator = (await createAccount(db.migrator, { siteIds: [SITE_A, SITE_B] })).accountId;
});

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
describe('una importación limpia', () => {
  it('crea las personas de las dos plantas y deja un lote registrado', async () => {
    const report = await importFile(
      file('C-1,Ada,Reid,roster-a,active', 'C-2,Bo,Chen,roster-b,active'),
      { filename: 'clean.csv' },
    );

    expect(report).toMatchObject({
      source_filename: 'clean.csv',
      rows_read: 2,
      rows_applied: 2,
      rows_rejected: 0,
      rejections: [],
    });

    expect((await byEmployeeNumber('C-1'))?.site_id).toBe(SITE_A);
    expect((await byEmployeeNumber('C-2'))?.site_id).toBe(SITE_B);

    const batches = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM roster_import WHERE id = $1',
      [report.import_id],
    );

    expect(one(batches).count).toBe('1');
  });

  it('reimportar el mismo archivo deja el roster igual y registra un segundo lote', async () => {
    const text = file('R-1,Ada,Reid,roster-a,active', 'R-2,Bo,Chen,roster-b,active');

    const first = await importFile(text, { filename: 'twice.csv' });
    const second = await importFile(text, { filename: 'twice.csv' });

    expect(second.rows_applied).toBe(first.rows_applied);
    expect(first.import_id).not.toBe(second.import_id);

    const people = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      "SELECT count(*)::text AS count FROM person WHERE employee_number IN ('R-1', 'R-2')",
    );

    expect(one(people).count).toBe('2');
  });

  it('actualiza a una persona que ya estaba, sin crear una segunda', async () => {
    await importFile(file('U-1,Ada,Reid,roster-a,active'));
    await importFile(file('U-1,Ada,Nuevoapellido,roster-a,active'));

    const person = await byEmployeeNumber('U-1');

    expect(person?.last_name).toBe('Nuevoapellido');

    const count = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      "SELECT count(*)::text AS count FROM person WHERE employee_number = 'U-1'",
    );

    expect(one(count).count).toBe('1');
  });

  it('rechaza un número oculto por RLS sin abortar las demás filas', async () => {
    await importFile(file('HIDDEN-1,Fuera,Alcance,roster-c,active'), { siteIds: [SITE_C] });

    const report = await importFile(
      file('HIDDEN-1,No,DebeCambiar,roster-a,active', 'VISIBLE-1,Sí,Seaplica,roster-a,active'),
      { siteIds: [SITE_A] },
    );

    expect(report).toMatchObject({ rows_read: 2, rows_applied: 1, rows_rejected: 1 });
    expect(report.rejections[0]).toMatchObject({ row_number: 2, employee_number: 'HIDDEN-1' });
    expect(report.rejections[0]?.reason).not.toMatch(/roster-c/i);
    expect((await byEmployeeNumber('HIDDEN-1'))?.last_name).toBe('Alcance');
    expect(await byEmployeeNumber('VISIBLE-1')).not.toBeNull();
  });

  it('una transferencia por archivo mueve a la persona de planta', async () => {
    await importFile(file('T-1,Ada,Reid,roster-a,active'));
    await importFile(file('T-1,Ada,Reid,roster-b,active'));

    expect((await byEmployeeNumber('T-1'))?.site_id).toBe(SITE_B);
  });
});

// ---------------------------------------------------------------------------
describe('las filas rechazadas', () => {
  it('un archivo de muchas filas con tres malas aplica el resto y explica las tres', async () => {
    const rows: string[] = [];

    for (let i = 1; i <= 197; i += 1) {
      rows.push(`M-${i},Nombre${i},Apellido${i},roster-a,active`);
    }

    rows.push(',Sin,Numero,roster-a,active');
    rows.push('M-BAD,Mal,Sitio,roster-z,active');
    rows.push('M-1,Duplicada,Fila,roster-a,active');

    const report = await importFile(rows.length > 0 ? file(...rows) : file(), {
      filename: 'big.csv',
    });

    expect(report.rows_read).toBe(200);
    expect(report.rows_applied).toBe(197);
    expect(report.rows_rejected).toBe(3);
    expect(report.rejections).toHaveLength(3);

    // El número de fila es el que se ve en Excel: encabezado = 1.
    expect(report.rejections.map((rejection) => rejection.row_number).sort((a, b) => a - b)).toEqual([
      199, 200, 201,
    ]);
  });

  it('cada clase de rechazo dice su motivo', async () => {
    const report = await importFile(
      file(
        'K-1,Ada,Reid,roster-a,active',
        ',Sin,Numero,roster-a,active',
        'K-2,Mal,Sitio,roster-z,active',
        'K-1,Duplicada,Fila,roster-a,active',
        'K-3,Mal,Estado,roster-a,despedida',
        'K-4,Fuera,Dealcance,roster-c,active',
      ),
      { filename: 'reasons.csv' },
    );

    const reasons = new Map(
      report.rejections.map((rejection) => [rejection.row_number, rejection.reason]),
    );

    expect(reasons.get(3)).toMatch(/employee_number/);
    expect(reasons.get(4)).toMatch(/site_code/);
    expect(reasons.get(5)).toMatch(/duplicate/i);
    expect(reasons.get(6)).toMatch(/status/);
    // Un sitio que existe pero que el importador no administra se rechaza con el
    // mismo motivo que uno inexistente: desde su lado son la misma situación.
    expect(reasons.get(7)).toMatch(/site_code/);

    expect(report.rows_applied).toBe(1);
    expect(await byEmployeeNumber('K-4')).toBeNull();
  });

  it('la primera aparición de un duplicado se aplica y la segunda se rechaza', async () => {
    await importFile(file('D-1,Ada,Primera,roster-a,active', 'D-1,Ada,Segunda,roster-b,active'));

    const person = await byEmployeeNumber('D-1');

    expect(person?.last_name).toBe('Primera');
    expect(person?.site_id).toBe(SITE_A);
  });

  it('un archivo limpio no reporta ningún rechazo', async () => {
    const report = await importFile(file('N-1,Ada,Reid,roster-a,active'));

    expect(report.rows_rejected).toBe(0);
    expect(report.rejections).toEqual([]);
  });

  it('guarda la fila cruda junto al rechazo', async () => {
    const report = await importFile(file('W-1,Ada,Reid,roster-a,mal-estado'), {
      filename: 'raw.csv',
    });

    const rows = await inScope<{ raw_row: Record<string, string>; reason: string }>(
      db.migrator,
      [],
      'SELECT raw_row, reason FROM roster_import_rejection WHERE import_id = $1',
      [report.import_id],
    );

    expect(one(rows).raw_row.employee_number).toBe('W-1');
    expect(one(rows).raw_row.status).toBe('mal-estado');
  });
});

// ---------------------------------------------------------------------------
describe('la ausencia del archivo no da de baja a nadie', () => {
  it('las personas que no aparecen quedan exactamente como estaban', async () => {
    await importFile(
      file(
        'A-1,Uno,Presente,roster-a,active',
        'A-2,Dos,Ausente,roster-a,active',
        'A-3,Tres,Ausente,roster-b,active',
      ),
    );

    const before = await Promise.all([byEmployeeNumber('A-2'), byEmployeeNumber('A-3')]);

    // El export con el filtro puesto: una sola fila de las tres.
    await importFile(file('A-1,Uno,Presente,roster-a,active'));

    const after = await Promise.all([byEmployeeNumber('A-2'), byEmployeeNumber('A-3')]);

    expect(after).toEqual(before);
    expect(after.every((person) => person?.deactivated_at === null)).toBe(true);
  });

  it('un status inactive explícito sí da de baja, y la persona sigue resolviendo', async () => {
    await importFile(file('B-1,Ada,Reid,roster-a,active'));

    const id = (await byEmployeeNumber('B-1'))!.id;

    await importFile(file('B-1,Ada,Reid,roster-a,inactive'));

    expect((await personById(db.migrator, [SITE_A], id)).deactivated_at).not.toBeNull();
    expect((await selectablePeople(db.migrator, [SITE_A])).map((row) => row.id)).not.toContain(id);
    expect((await personById(db.migrator, [SITE_A], id)).employee_number).toBe('B-1');
  });

  it('un status active vuelve a activar a una persona dada de baja', async () => {
    await importFile(file('B-2,Ada,Reid,roster-a,inactive'));
    await importFile(file('B-2,Ada,Reid,roster-a,active'));

    expect((await byEmployeeNumber('B-2'))?.deactivated_at).toBeNull();
  });

  it('un archivo con encabezado y sin filas no toca a nadie', async () => {
    const before = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      'SELECT count(*)::text AS count FROM person WHERE deactivated_at IS NULL',
    );

    const report = await importFile(HEADER, { filename: 'empty.csv' });

    const after = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      'SELECT count(*)::text AS count FROM person WHERE deactivated_at IS NULL',
    );

    expect(report).toMatchObject({ rows_read: 0, rows_applied: 0, rows_rejected: 0 });
    expect(one(after).count).toBe(one(before).count);
  });
});

// ---------------------------------------------------------------------------
describe('la importación es una sola transacción', () => {
  it('un fallo a mitad de camino no deja ninguna persona ni ningún lote', async () => {
    await importFile(file('F-1,Ada,Reid,roster-a,active'));

    const batchesBefore = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM roster_import',
    );
    const auditBefore = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A],
      'SELECT count(*)::text AS count FROM audit_log',
    );

    // El rechazo duplicado falla al final, después de persona, lote, desglose,
    // auditoría y primer rechazo: el rollback tiene que llevarse todos juntos.
    await expect(
      applyRoster(
        db.app,
        parsedWithLateFailure('F-2'),
        { siteIds: [SITE_A], userId: coordinator },
        { sourceFilename: 'boom.csv' },
      ),
    ).rejects.toBeTruthy();

    const batchesAfter = await inScope<{ count: string }>(
      db.migrator,
      [],
      'SELECT count(*)::text AS count FROM roster_import',
    );

    expect(one(batchesAfter).count).toBe(one(batchesBefore).count);
    expect(await byEmployeeNumber('F-2')).toBeNull();
    const auditAfter = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A],
      'SELECT count(*)::text AS count FROM audit_log',
    );
    expect(one(auditAfter).count).toBe(one(auditBefore).count);
    // Y la persona que ya estaba sigue estando: el rollback no se llevó puesto lo
    // que había antes de esta importación.
    expect(await byEmployeeNumber('F-1')).not.toBeNull();
  });

  it('el wrapper de sesión también revierte personas y reporte ante un fallo tardío', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = db.appUrl;
    const service = new DbService();
    process.env.DATABASE_URL = previous;

    try {
      await expect(
        service.withSessionClient(
          { userId: coordinator, role: 'coordinator', siteIds: [SITE_A] },
          (client) =>
            applyRosterRows(
              client,
              parsedWithLateFailure('F-SESSION'),
              { siteIds: [SITE_A], userId: coordinator },
              { sourceFilename: 'boom-session.csv' },
            ),
        ),
      ).rejects.toBeTruthy();

      expect(await byEmployeeNumber('F-SESSION')).toBeNull();
      const imports = await inScope<{ count: string }>(
        db.migrator,
        [],
        "SELECT count(*)::text AS count FROM roster_import WHERE source_filename = 'boom-session.csv'",
      );
      expect(one(imports).count).toBe('0');
    } finally {
      await service.onModuleDestroy();
    }
  });
});

// ---------------------------------------------------------------------------
describe('el reporte queda como registro inmutable', () => {
  it('no se puede editar ni borrar el lote ni sus rechazos', async () => {
    const report = await importFile(file('I-1,Ada,Reid,roster-z,active'), { filename: 'frozen.csv' });

    for (const table of ['roster_import', 'roster_import_rejection', 'roster_import_site']) {
      await expect(
        inScope(db.migrator, [], `DELETE FROM ${table}`),
      ).rejects.toMatchObject({ code: APPEND_ONLY });
    }

    await expect(
      inScope(db.app, [], 'UPDATE roster_import SET rows_applied = 999 WHERE id = $1', [
        report.import_id,
      ]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      inScope(db.migrator, [], 'UPDATE roster_import SET rows_applied = 999 WHERE id = $1', [
        report.import_id,
      ]),
    ).rejects.toMatchObject({ code: APPEND_ONLY });
  });
});

// ---------------------------------------------------------------------------
describe('la auditoría de la importación', () => {
  it('escribe una entrada de resumen por planta tocada, con los contadores de esa planta', async () => {
    const report = await importFile(
      file(
        'S-1,Uno,A,roster-a,active',
        'S-2,Dos,A,roster-a,active',
        'S-3,Tres,B,roster-b,active',
        'S-4,Cuatro,B,roster-b,mal-estado',
      ),
      { filename: 'summary.csv' },
    );

    for (const [site, applied, rejected] of [
      [SITE_A, 2, 0],
      [SITE_B, 1, 1],
    ] as const) {
      const entries = await inScope<{ payload: Record<string, unknown>; actor_user_id: string }>(
        db.migrator,
        [site],
        `SELECT payload, actor_user_id FROM audit_log
          WHERE site_id = $1 AND event_type = 'roster.imported' AND payload ->> 'import_id' = $2`,
        [site, report.import_id],
      );

      expect(entries).toHaveLength(1);
      expect(one(entries).payload).toMatchObject({
        source_filename: 'summary.csv',
        rows_applied: applied,
        rows_rejected: rejected,
      });
      expect(one(entries).actor_user_id).toBe(coordinator);
    }
  });

  it('una importación que toca una sola planta escribe una sola entrada de resumen', async () => {
    const report = await importFile(file('O-1,Uno,Solo,roster-a,active'), { filename: 'one.csv' });

    const entries = await inScope<{ site_id: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      `SELECT site_id FROM audit_log
        WHERE event_type = 'roster.imported' AND payload ->> 'import_id' = $1`,
      [report.import_id],
    );

    expect(entries).toHaveLength(1);
    expect(one(entries).site_id).toBe(SITE_A);
  });

  it('escribe una entrada de roster por cada fila aplicada', async () => {
    const report = await importFile(
      file('P-1,Uno,A,roster-a,active', 'P-2,Dos,A,roster-a,active', 'P-3,Tres,A,roster-a,active'),
      { filename: 'perrow.csv' },
    );

    const created = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A],
      `SELECT count(*)::text AS count FROM audit_log
        WHERE site_id = $1 AND event_type = 'person.created'
          AND payload ->> 'employee_number' LIKE 'P-%'`,
      [SITE_A],
    );

    expect(one(created).count).toBe('3');
    expect(report.rows_applied).toBe(3);
  });

  it('la cadena sigue verificando después de todas las importaciones', async () => {
    for (const site of [SITE_A, SITE_B]) {
      const broken = await inScope(db.migrator, [site], 'SELECT * FROM hs_audit_verify_chain($1)', [
        site,
      ]);

      expect(broken).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('el costo de una importación real', () => {
  it('200 filas con sus 200 entradas encadenadas terminan en un tiempo medido', async () => {
    const rows: string[] = [];

    for (let i = 1; i <= 200; i += 1) {
      rows.push(`Z-${i},Nombre${i},Apellido${i},roster-a,active`);
    }

    const started = Date.now();
    const report = await importFile(file(...rows), { filename: 'perf.csv' });
    const elapsed = Date.now() - started;

    expect(report.rows_applied).toBe(200);

    // El número queda a la vista para que, si alguna vez son 5.000 filas, se sepa
    // de qué orden se parte. La cadena de auditoría serializa por sitio con un
    // lock, así que el lote toma el lock de la planta toda la transacción.
    console.log(`roster import: 200 filas en ${elapsed} ms`);

    expect(elapsed).toBeLessThan(30_000);
  });
});
