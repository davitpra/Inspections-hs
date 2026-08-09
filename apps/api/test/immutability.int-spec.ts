import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withSiteScope } from '../src/db/site-scope';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';
import {
  insertEvent,
  inScope,
  one,
  sqlstate,
  startTestDatabase,
  type TestDatabase,
} from './helpers/postgres';

const SITE_A = '11111111-1111-1111-1111-111111111111';
const SITE_B = '22222222-2222-2222-2222-222222222222';

/** insufficient_privilege. También es el SQLSTATE de una violación de política RLS. */
const INSUFFICIENT_PRIVILEGE = '42501';

/** El SQLSTATE propio del trigger de inmutabilidad (migración 0001). */
const APPEND_ONLY = 'HS001';

let db: TestDatabase;
let seeded: { id: string; hash: Buffer };

beforeAll(async () => {
  db = await startTestDatabase();

  // Desde `0004` toda entrada del log referencia una fila de `site`: un evento
  // que nadie puede atribuir a un lugar de trabajo no sostiene nada.
  await registerSite(db.migrator, SITE_A, 'immutability-a');
  await registerSite(db.migrator, SITE_B, 'immutability-b');

  const row = await insertEvent(db.app, SITE_A, { payload: { seeded: true } });
  seeded = { id: row.id, hash: row.hash };
});

afterAll(async () => {
  await db?.stop();
});

describe('el rol de la aplicación no puede mutar filas inmutables', () => {
  // Spike 2 de requisitos §7: el UPDATE con el rol de la app falla en el motor.
  it('rechaza UPDATE con 42501 y deja la fila intacta', async () => {
    await expect(
      inScope(db.app, [SITE_A], `UPDATE audit_log SET payload = '{}'::jsonb WHERE id = $1`, [
        seeded.id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const row = one(
      await inScope<{ payload: unknown; hash: Buffer }>(
        db.app,
        [SITE_A],
        'SELECT payload, hash FROM audit_log WHERE id = $1',
        [seeded.id],
      ),
    );

    expect(row.payload).toEqual({ seeded: true });
    expect(row.hash.equals(seeded.hash)).toBe(true);
  });

  it('rechaza DELETE con 42501 y la fila sigue estando', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'DELETE FROM audit_log WHERE id = $1', [seeded.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const rows = await inScope(db.app, [SITE_A], 'SELECT id FROM audit_log WHERE id = $1', [
      seeded.id,
    ]);

    expect(rows).toHaveLength(1);
  });

  it('rechaza TRUNCATE con 42501', async () => {
    await expect(inScope(db.app, [SITE_A], 'TRUNCATE audit_log')).rejects.toSatisfy(
      (error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE,
    );
  });

  it('no puede crear tablas ni tocar el trigger de inmutabilidad', async () => {
    await expect(inScope(db.app, [SITE_A], 'CREATE TABLE probe (id int)')).rejects.toSatisfy(
      (error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE,
    );

    // No es dueño de la tabla: no puede desarmar la barrera.
    await expect(
      inScope(db.app, [SITE_A], 'DROP TRIGGER audit_log_forbid_mutation ON audit_log'),
    ).rejects.toThrow();
  });

  it('acepta INSERT dentro del alcance de sitio', async () => {
    const row = await insertEvent(db.app, SITE_A, { payload: { inserted: true } });

    expect(row.id).toBeTruthy();
    expect(row.payload).toEqual({ inserted: true });
  });
});

describe('el trigger frena también al dueño de la tabla', () => {
  // Con hs_app el REVOKE dispara primero y el trigger nunca llega a ejecutarse.
  // hs_migrator es dueño de la tabla y tiene el privilegio, así que es el único
  // rol con el que se puede probar la segunda barrera.
  it('rechaza UPDATE de hs_migrator con el SQLSTATE del trigger', async () => {
    let caught: unknown;

    try {
      await inScope(db.migrator, [SITE_A], `UPDATE audit_log SET payload = '{}'::jsonb WHERE id = $1`, [
        seeded.id,
      ]);
    } catch (error) {
      caught = error;
    }

    expect(sqlstate(caught)).toBe(APPEND_ONLY);
    expect((caught as Error).message).toContain('audit_log');
    expect((caught as Error).message).toContain('append-only');
  });

  it('rechaza DELETE de hs_migrator y la fila sigue estando', async () => {
    await expect(
      inScope(db.migrator, [SITE_A], 'DELETE FROM audit_log WHERE id = $1', [seeded.id]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);

    const rows = await inScope(db.app, [SITE_A], 'SELECT id FROM audit_log WHERE id = $1', [
      seeded.id,
    ]);

    expect(rows).toHaveLength(1);
  });
});

describe('aislamiento por sitio', () => {
  beforeAll(async () => {
    await insertEvent(db.app, SITE_B, { payload: { site: 'b' } });
    await insertEvent(db.app, SITE_B, { payload: { site: 'b' } });
  });

  it('el alcance de un sitio no ve las filas del otro', async () => {
    const row = one(
      await inScope<{ count: string }>(
      db.app,
      [SITE_B],
      'SELECT count(*)::text AS count FROM audit_log',
    ),
    );

    const all = one(
      await inScope<{ count: string }>(
      db.app,
      [SITE_A, SITE_B],
      'SELECT count(*)::text AS count FROM audit_log',
    ),
    );

    expect(row.count).toBe('2');
    expect(Number(all.count)).toBeGreaterThan(2);
  });

  it('rechaza un INSERT fuera del alcance declarado', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO audit_log (site_id, event_type, payload, occurred_at, recorded_at, hash)
         VALUES ($1, 'x', '{}'::jsonb, now(), now(), '\\x00'::bytea)`,
        [SITE_B],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('sin alcance declarado devuelve cero filas, no todas', async () => {
    const row = one(
      await inScope<{ count: string }>(
      db.app,
      [],
      'SELECT count(*)::text AS count FROM audit_log',
    ),
    );

    expect(row.count).toBe('0');
  });

  // FORCE ROW LEVEL SECURITY: sin él, el dueño de la tabla evade sus políticas.
  it('hs_migrator tampoco evade las políticas por sitio', async () => {
    const row = one(
      await inScope<{ count: string }>(
      db.migrator,
      [SITE_B],
      'SELECT count(*)::text AS count FROM audit_log',
    ),
    );

    expect(row.count).toBe('2');
  });

  // SET LOCAL, no SET: el alcance muere con la transacción. Si sobreviviera, una
  // conexión del pool arrastraría el alcance de un request al siguiente.
  it('el alcance no sobrevive a la transacción en una conexión reusada', async () => {
    const single = db.singleConnectionApp();

    const before = await withSiteScope(single, { siteIds: [SITE_A, SITE_B] }, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM audit_log',
      );
      return one(result.rows).count;
    });

    const after = await withSiteScope(single, { siteIds: [] }, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM audit_log',
      );
      return one(result.rows).count;
    });

    expect(Number(before)).toBeGreaterThan(0);
    expect(after).toBe('0');
  });
});

/**
 * Migración 0009 — El envío congelado y sus respuestas.
 *
 * Las dos tablas más estrictas del sistema: no tienen un solo `GRANT UPDATE`, así que
 * "parcialmente mutable" ni siquiera es una pregunta. Lo que estos casos prueban es que
 * las dos barreras están puestas sobre las dos tablas y no sobre una sola — el olvido
 * típico es aplicar `hs_make_immutable` a la tabla cabecera y dejar la de detalle sin
 * nada, que deja el registro legal corregible por la puerta de atrás.
 */
describe('el envío de una inspección y sus respuestas', () => {
  let inspectionId: string;
  let answerId: string;
  let scheduledId: string;
  let versionId: string;
  let accountId: string;

  beforeAll(async () => {
    const templateId = await createTemplate(db.migrator, 'immutable-submission', 'Walkthrough');
    // Dos ítems: uno queda contestado y el otro libre, para que los casos de FK no
    // choquen antes contra el único `(inspection_id, item_key)`.
    await registerItems(db.migrator, templateId, ['imm.guards', 'imm.exits']);

    versionId = await publishVersion(db.migrator, templateId, 1, {
      sections: [
        {
          section_key: 'general',
          section_title: 'General',
          position: 1,
          items: [
            {
              item_key: 'imm.guards',
              prompt: 'Machine guards in place',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
            {
              item_key: 'imm.exits',
              prompt: 'Exits clear',
              position: 2,
              required: true,
              response_type: 'yes_no',
            },
          ],
        },
      ],
    });

    const account = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
    accountId = account.accountId;

    scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2031-05-01',
      templateId,
      templateVersionId: versionId,
      inspectorId: accountId,
    });

    const inspectionRows = await inScope<{ id: string }>(
      db.app,
      [SITE_A],
      `INSERT INTO inspection (site_id, scheduled_inspection_id, template_version_id,
                               client_submission_id, submitted_by, signed_at, answer_count)
       VALUES ($1, $2, $3, gen_random_uuid(), $4, now(), 1)
       RETURNING id`,
      [SITE_A, scheduledId, versionId, accountId],
    );

    inspectionId = one(inspectionRows).id;

    const answerRows = await inScope<{ id: string }>(
      db.app,
      [SITE_A],
      `INSERT INTO inspection_answer (inspection_id, site_id, template_version_item_id,
                                      item_key, value)
       SELECT $1, $2, v.id, v.item_key, 'false'::jsonb
         FROM template_version_item v
        WHERE v.template_version_id = $3 AND v.item_key = 'imm.guards'
       RETURNING id`,
      [inspectionId, SITE_A, versionId],
    );

    answerId = one(answerRows).id;
  });

  it('hs_app no puede corregir una respuesta', async () => {
    await expect(
      inScope(db.app, [SITE_A], `UPDATE inspection_answer SET value = '"yes"'::jsonb WHERE id = $1`, [
        answerId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    const row = one(
      await inScope<{ value: unknown }>(
        db.app,
        [SITE_A],
        'SELECT value FROM inspection_answer WHERE id = $1',
        [answerId],
      ),
    );

    expect(row.value).toBe(false);
  });

  it('hs_app no puede cambiar quién firmó', async () => {
    await expect(
      inScope(db.app, [SITE_A], 'UPDATE inspection SET submitted_by = $2 WHERE id = $1', [
        inspectionId,
        accountId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);
  });

  it('el trigger frena al dueño de la tabla en las dos', async () => {
    for (const statement of [
      `UPDATE inspection SET answer_count = 99 WHERE id = '${inspectionId}'`,
      `UPDATE inspection_answer SET value = '"yes"'::jsonb WHERE id = '${answerId}'`,
    ]) {
      let caught: unknown;

      try {
        await inScope(db.migrator, [SITE_A], statement);
      } catch (error) {
        caught = error;
      }

      expect(sqlstate(caught)).toBe(APPEND_ONLY);
      expect((caught as Error).message).toContain('append-only');
    }
  });

  it('ningún rol borra ni trunca ninguna de las dos', async () => {
    const attempts: [typeof db.app, string][] = [
      [db.app, `DELETE FROM inspection_answer WHERE id = '${answerId}'`],
      [db.app, `DELETE FROM inspection WHERE id = '${inspectionId}'`],
      [db.app, 'TRUNCATE inspection_answer'],
      [db.app, 'TRUNCATE inspection'],
      [db.migrator, `DELETE FROM inspection_answer WHERE id = '${answerId}'`],
      [db.migrator, `DELETE FROM inspection WHERE id = '${inspectionId}'`],
      [db.migrator, 'TRUNCATE inspection_answer'],
      [db.migrator, 'TRUNCATE inspection'],
    ];

    for (const [pool, statement] of attempts) {
      await expect(inScope(pool, [SITE_A], statement)).rejects.toSatisfy((error) =>
        // `0A000` es el tercero y aparece en un solo caso: `TRUNCATE inspection` con el
        // rol dueño lo rechaza la comprobación referencial —`inspection_answer` la
        // referencia— ANTES de que el trigger de guarda llegue a correr. La propiedad
        // que importa se cumple igual: ningún rol saca estas filas. Cuál de las tres
        // barreras la atrapa es incidental, y por eso el caso acepta las tres en vez de
        // fingir que solo hay una.
        [INSUFFICIENT_PRIVILEGE, APPEND_ONLY, '0A000'].includes(sqlstate(error) ?? ''),
      );
    }

    const rows = await inScope(
      db.app,
      [SITE_A],
      'SELECT id FROM inspection WHERE id = $1',
      [inspectionId],
    );

    expect(rows).toHaveLength(1);
  });

  it('una respuesta no puede pertenecer a otra planta que su inspección', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A, SITE_B],
        `INSERT INTO inspection_answer (inspection_id, site_id, template_version_item_id,
                                        item_key, value)
         SELECT $1, $2, v.id, v.item_key, 'true'::jsonb
           FROM template_version_item v
          WHERE v.template_version_id = $3 AND v.item_key = 'imm.exits'`,
        [inspectionId, SITE_B, versionId],
      ),
      // 23503: violación de la FK compuesta `(inspection_id, site_id)`. El alcance
      // declara las DOS plantas a propósito: sin eso la rechazaría la política y no se
      // sabría si la FK compuesta existe.
    ).rejects.toSatisfy((error) => sqlstate(error) === '23503');
  });

  it('una respuesta no puede reclamar una item_key que no es la del ítem que referencia', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO inspection_answer (inspection_id, site_id, template_version_item_id,
                                        item_key, value)
         SELECT $1, $2, v.id, 'imm.exits', 'true'::jsonb
           FROM template_version_item v
          WHERE v.template_version_id = $3 AND v.item_key = 'imm.guards'`,
        [inspectionId, SITE_A, versionId],
      ),
      // Las dos `item_key` existen y las dos están en esta versión: lo único que falla
      // es el PAR. Es la FK compuesta contra `template_version_item (id, item_key)`, y
      // no la FK simple contra `template_item`, la que tiene que atraparlo.
    ).rejects.toSatisfy((error) => sqlstate(error) === '23503');
  });

  it('el mismo ítem no se contesta dos veces en la misma inspección', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO inspection_answer (inspection_id, site_id, template_version_item_id,
                                        item_key, value)
         SELECT $1, $2, v.id, v.item_key, 'true'::jsonb
           FROM template_version_item v
          WHERE v.template_version_id = $3 AND v.item_key = 'imm.guards'`,
        [inspectionId, SITE_A, versionId],
      ),
      // 23505: el único `(inspection_id, item_key)`.
    ).rejects.toSatisfy((error) => sqlstate(error) === '23505');
  });

  it('la otra planta no ve el envío ni sus respuestas, y sin alcance no se ve nada', async () => {
    const fromB = one(
      await inScope<{ count: string }>(
        db.app,
        [SITE_B],
        'SELECT count(*)::text AS count FROM inspection',
      ),
    );

    const answersFromB = one(
      await inScope<{ count: string }>(
        db.app,
        [SITE_B],
        'SELECT count(*)::text AS count FROM inspection_answer',
      ),
    );

    const unscoped = one(
      await inScope<{ count: string }>(
        db.app,
        [],
        'SELECT count(*)::text AS count FROM inspection',
      ),
    );

    expect(fromB.count).toBe('0');
    expect(answersFromB.count).toBe('0');
    expect(unscoped.count).toBe('0');
  });

  it('rechaza un INSERT de envío que nombra otra planta, y no queda fila', async () => {
    // LA GUARDA GANA DE MANO A LA POLÍTICA, y es correcto que así sea: el trigger
    // `BEFORE INSERT` corre antes del `WITH CHECK`, así que esto falla con `HS002`
    // ("submission claims site X but the inspection belongs to Y") y no con `42501`.
    //
    // No hay forma de llegar al `WITH CHECK` de esta tabla: la guarda lee la inspección
    // programada bajo la misma política, así que un `site_id` que no coincida con el de
    // la programada —o una programada que la transacción no ve— siempre choca primero.
    // Lo que la política defiende de verdad acá es la LECTURA, que es el caso de arriba.
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO inspection (site_id, scheduled_inspection_id, template_version_id,
                                 client_submission_id, submitted_by, signed_at, answer_count)
         VALUES ($1, $2, $3, gen_random_uuid(), $4, now(), 0)`,
        [SITE_B, scheduledId, versionId, accountId],
      ),
    ).rejects.toSatisfy((error) =>
      [INSUFFICIENT_PRIVILEGE, 'HS002'].includes(sqlstate(error) ?? ''),
    );

    const rows = await inScope(
      db.app,
      [SITE_A, SITE_B],
      'SELECT id FROM inspection WHERE scheduled_inspection_id = $1',
      [scheduledId],
    );

    expect(rows).toHaveLength(1);
  });
});
