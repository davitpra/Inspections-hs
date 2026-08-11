import type { TemplateDocument } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import {
  OPEN_PERIOD_CRON,
  OPEN_PERIOD_JOB,
  SITE_TIME_ZONE,
} from '../src/jobs/job-registry';
import { installJobSchema } from '../scripts/jobs-install.mjs';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { createSchedule, notificationsFor, scheduledForPeriod } from './helpers/inspections';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createRunningJobs, createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * La apertura del período, la bandeja del coordinador y los endpoints de programación.
 *
 * Lo que el motor rechaza está en `inspection-scheduling.int-spec.ts`; acá se prueba lo
 * que el sistema HACE — incluida la propiedad que más importa del trabajo, que es que
 * correrlo de más no produce de más.
 */

const SITE_A = '9b000000-0000-4000-8000-000000000001';
const SITE_B = '9b000000-0000-4000-8000-000000000002';

/**
 * `2026-09-01T02:00:00Z` es el 31 de agosto a las 22:00 en Ontario. Si el trabajo
 * resolviera el período en UTC abriría septiembre; el requisito es que abra agosto.
 */
const LATE_AUGUST_UTC = new Date('2026-09-01T02:00:00Z');
const AUGUST = '2026-08-01';

let db: TestDatabase;
let stack: SchedulingStack;
let templateId: string;
let versionV1: string;
let coordinator: { accountId: string };
let inspector: { accountId: string };

function documentFor(itemKey: string): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: itemKey,
            prompt: 'Is the guard in place?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  db = await startTestDatabase();
  await installJobSchema(db.migrator);

  stack = createSchedulingStack(db.appUrl);

  await registerSite(db.migrator, SITE_A, 'period-a');
  await registerSite(db.migrator, SITE_B, 'period-b');

  templateId = await createTemplate(db.migrator, 'period-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ['p.guard']);
  versionV1 = await publishVersion(db.migrator, templateId, 1, documentFor('p.guard'));

  coordinator = await createAccount(db.app, { siteIds: [SITE_A], role: 'hs_coordinator' });
  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('la apertura del período', () => {
  beforeAll(async () => {
    await createSchedule(db.app, SITE_A, templateId, inspector.accountId);
  });

  it('resuelve el período en el calendario de la planta, no en UTC', async () => {
    const result = await stack.openPeriod.run(LATE_AUGUST_UTC);

    expect(result.periodStart).toBe(AUGUST);
    expect(result.opened).toBe(1);

    const rows = await scheduledForPeriod(db.app, [SITE_A, SITE_B], AUGUST);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.period_end).toBe('2026-08-31');
  });

  it('congela la versión más alta publicada al momento de abrir', async () => {
    const rows = await scheduledForPeriod(db.app, [SITE_A], AUGUST);
    expect(one(rows).template_version_id).toBe(versionV1);
  });

  it('asigna el inspector por defecto de la regla', async () => {
    const rows = await scheduledForPeriod(db.app, [SITE_A], AUGUST);
    expect(one(rows).inspector_id).toBe(inspector.accountId);
  });

  it('deja `scheduled_by` en nulo: la abrió el calendario, no una persona', async () => {
    const rows = await scheduledForPeriod(db.app, [SITE_A], AUGUST);
    expect(one(rows).scheduled_by).toBeNull();
  });

  it('correr el trabajo dos veces deja una sola fila', async () => {
    const second = await stack.openPeriod.run(LATE_AUGUST_UTC);

    expect(second.opened).toBe(0);
    expect(await scheduledForPeriod(db.app, [SITE_A, SITE_B], AUGUST)).toHaveLength(1);
  });

  it('dos corridas concurrentes dejan una sola fila y ninguna falla', async () => {
    const september = new Date('2026-09-15T12:00:00Z');

    const [first, secondRun] = await Promise.all([
      stack.openPeriod.run(september),
      stack.openPeriod.run(september),
    ]);

    // Una abrió y la otra no; cuál de las dos es una carrera y no importa.
    expect(first.opened + secondRun.opened).toBe(1);
    expect(await scheduledForPeriod(db.app, [SITE_A, SITE_B], '2026-09-01')).toHaveLength(1);
  });

  it('una regla desactivada no abre nada y no toca lo que ya abrió', async () => {
    const before = await scheduledForPeriod(db.app, [SITE_A], AUGUST);

    await inScope(db.app, [SITE_A], 'UPDATE inspection_schedule SET deactivated_at = now()', []);

    const result = await stack.openPeriod.run(new Date('2026-10-10T12:00:00Z'));

    expect(result.opened).toBe(0);
    expect(await scheduledForPeriod(db.app, [SITE_A], '2026-10-01')).toHaveLength(0);
    expect(await scheduledForPeriod(db.app, [SITE_A], AUGUST)).toEqual(before);
  });
});

describe('la notificación al coordinador', () => {
  const NOVEMBER = '2026-11-01';

  let outsider: { accountId: string };

  beforeAll(async () => {
    // Un coordinador cuyo alcance es solo la otra planta: no le corresponde enterarse.
    outsider = await createAccount(db.app, { siteIds: [SITE_B], role: 'hs_coordinator' });

    await createSchedule(db.app, SITE_A, templateId, inspector.accountId);
    await stack.openPeriod.run(new Date('2026-11-10T12:00:00Z'));
  });

  it('notifica al coordinador con alcance en la planta', async () => {
    const rows = await notificationsFor(db.app, [SITE_A], coordinator.accountId);
    const opened = rows.filter((row) => row.dedupe_key === `${SITE_A}:${NOVEMBER}`);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.kind).toBe('inspection_period_opened');
    expect(opened[0]?.payload.period_start).toBe(NOVEMBER);
    expect(opened[0]?.payload.period_end).toBe('2026-11-30');
    expect((opened[0]?.payload.opened as unknown[]) ?? []).toHaveLength(1);
  });

  it('no notifica a un coordinador sin alcance en esa planta', async () => {
    const rows = await notificationsFor(db.app, [SITE_A, SITE_B], outsider.accountId);
    expect(rows).toHaveLength(0);
  });

  it('una segunda corrida no genera una segunda notificación', async () => {
    await stack.openPeriod.run(new Date('2026-11-20T12:00:00Z'));

    const rows = await notificationsFor(db.app, [SITE_A], coordinator.accountId);
    expect(rows.filter((row) => row.dedupe_key === `${SITE_A}:${NOVEMBER}`)).toHaveLength(1);
  });

  it('una corrida que no abre nada no notifica a nadie', async () => {
    const before = await notificationsFor(db.app, [SITE_A], coordinator.accountId);

    const result = await stack.openPeriod.run(new Date('2026-11-25T12:00:00Z'));

    expect(result.opened).toBe(0);
    expect(result.notified).toBe(0);
    expect(await notificationsFor(db.app, [SITE_A], coordinator.accountId)).toHaveLength(
      before.length,
    );
  });

  it('marcar como leída es lo único que cambia, y no se deshace', async () => {
    const session = { userId: coordinator.accountId, role: 'hs_coordinator', siteIds: [SITE_A] };
    const inbox = await stack.notifications.inbox(session);
    const target = one(inbox);

    const read = await stack.notifications.markRead(session, target.id);
    expect(read.read_at).not.toBeNull();

    await expect(
      inScope(db.app, [SITE_A], 'UPDATE notification SET read_at = NULL WHERE id = $1', [target.id]),
    ).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'HS001');

    await expect(
      inScope(db.app, [SITE_A], `UPDATE notification SET payload = '{}'::jsonb WHERE id = $1`, [
        target.id,
      ]),
    ).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === '42501');
  });
});

describe('los permisos de la programación', () => {
  const session = (accountId: string, role: string) => ({
    userId: accountId,
    role,
    siteIds: [SITE_A],
  });

  it('un jhsc_member no puede reasignar', async () => {
    const rows = await scheduledForPeriod(db.app, [SITE_A], AUGUST);
    const target = one(rows);

    await expect(
      stack.inspections.assignInspector(
        session(inspector.accountId, 'jhsc_member'),
        target.id,
        inspector.accountId,
      ),
    ).rejects.toMatchObject({ status: 403 });

    const after = await scheduledForPeriod(db.app, [SITE_A], AUGUST);
    expect(one(after).inspector_id).toBe(target.inspector_id);
  });

  it('un supervisor no puede crear una regla', async () => {
    const supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });

    await expect(
      stack.inspections.createSchedule(session(supervisor.accountId, 'supervisor'), {
        site_id: SITE_A,
        template_id: templateId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rechaza como inspector a una cuenta que no es del JHSC, y nombra el rol', async () => {
    const manager = await createAccount(db.app, { siteIds: [SITE_A], role: 'management' });

    await expect(
      stack.inspections.createSchedule(session(coordinator.accountId, 'hs_coordinator'), {
        site_id: SITE_A,
        template_id: templateId,
        default_inspector_id: manager.accountId,
      }),
    ).rejects.toThrow(/management/);
  });

  it('rechaza como inspector a quien no tiene alcance en la planta, y nombra el sitio', async () => {
    const elsewhere = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });

    await expect(
      stack.inspections.schedule(session(coordinator.accountId, 'hs_coordinator'), {
        site_id: SITE_A,
        template_id: templateId,
        period_start: '2027-03-01',
        inspector_id: elsewhere.accountId,
      }),
    ).rejects.toThrow(new RegExp(SITE_A));
  });

  it('rechaza una regla sobre una plantilla sin versión publicada', async () => {
    const unpublished = await createTemplate(db.migrator, 'never-published');

    await expect(
      stack.inspections.createSchedule(session(coordinator.accountId, 'hs_coordinator'), {
        site_id: SITE_A,
        template_id: unpublished,
      }),
    ).rejects.toThrow(/no published version/);
  });
});

describe('el pendiente de cada inspector', () => {
  let other: { accountId: string };

  beforeAll(async () => {
    other = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });

    const coordinatorSession = {
      userId: coordinator.accountId,
      role: 'hs_coordinator',
      siteIds: [SITE_A],
    };

    // Un período viejo y uno del futuro, para el orden y el flag de vencido.
    await stack.inspections.schedule(coordinatorSession, {
      site_id: SITE_A,
      template_id: templateId,
      period_start: '2020-01-01',
      inspector_id: other.accountId,
    });

    await stack.inspections.schedule(coordinatorSession, {
      site_id: SITE_A,
      template_id: templateId,
      period_start: '2099-01-01',
      inspector_id: other.accountId,
    });
  });

  it('lista solo lo propio', async () => {
    const mine = await stack.inspections.pendingFor({
      userId: other.accountId,
      role: 'jhsc_member',
      siteIds: [SITE_A],
    });

    expect(mine).toHaveLength(2);
    expect(mine.every((row) => row.template_name === 'Monthly walkthrough')).toBe(true);

    const theirs = await stack.inspections.pendingFor({
      userId: inspector.accountId,
      role: 'jhsc_member',
      siteIds: [SITE_A],
    });

    expect(theirs.some((row) => row.period_start === '2020-01-01')).toBe(false);
  });

  it('pone lo vencido primero y lo marca', async () => {
    const mine = await stack.inspections.pendingFor({
      userId: other.accountId,
      role: 'jhsc_member',
      siteIds: [SITE_A],
    });

    expect(mine[0]?.period_start).toBe('2020-01-01');
    expect(mine[0]?.overdue).toBe(true);
    expect(mine[1]?.period_start).toBe('2099-01-01');
    expect(mine[1]?.overdue).toBe(false);
  });

  it('una inspección cancelada desaparece del pendiente', async () => {
    const before = await stack.inspections.pendingFor({
      userId: other.accountId,
      role: 'jhsc_member',
      siteIds: [SITE_A],
    });

    const target = one(before);

    await stack.inspections.cancel(
      { userId: coordinator.accountId, role: 'hs_coordinator', siteIds: [SITE_A] },
      target.id,
      'plant shutdown for the month',
    );

    const after = await stack.inspections.pendingFor({
      userId: other.accountId,
      role: 'jhsc_member',
      siteIds: [SITE_A],
    });

    expect(after.map((row) => row.id)).not.toContain(target.id);
  });

  it('no devuelve nada sin alcance de sitio', async () => {
    const none = await stack.inspections.pendingFor({
      userId: other.accountId,
      role: 'jhsc_member',
      siteIds: [],
    });

    expect(none).toHaveLength(0);
  });
});

describe('el ciclo de vida del planificador', () => {
  it('dos réplicas arrancan, registran el mismo cron y paran sin romper', async () => {
    const first = createRunningJobs(db.appUrl);
    const second = createRunningJobs(db.appUrl);

    await Promise.all([first.onApplicationBootstrap(), second.onApplicationBootstrap()]);

    // Las dos registran el mismo cron: es un upsert por nombre de cola, no una segunda
    // programación. Es el caso de un despliegue con dos instancias.
    await Promise.all([
      first.schedule(OPEN_PERIOD_JOB, OPEN_PERIOD_CRON, SITE_TIME_ZONE, {}),
      second.schedule(OPEN_PERIOD_JOB, OPEN_PERIOD_CRON, SITE_TIME_ZONE, {}),
    ]);

    await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);
  });

  /**
   * El arranque REAL, con el grafo de módulos entero.
   *
   * Es lo que prueba que `OpenPeriodService` registra su cron DESPUÉS de que el
   * planificador arrancó. Sin la arista explícita `InspectionsModule -> JobsModule`, ese
   * orden queda librado a cómo se listaron los imports, y `requireStarted` convierte el
   * accidente en un arranque roto acá en vez de en un cron que no corre nunca.
   */
  it('la aplicación entera arranca y para limpio con el planificador adentro', async () => {
    const previousUrl = process.env.DATABASE_URL;
    const previousSecret = process.env.BETTER_AUTH_SECRET;
    const previousEnabled = process.env.JOBS_ENABLED;
    const previousBucket = process.env.S3_BUCKET;
    const previousKeyId = process.env.S3_ACCESS_KEY_ID;
    const previousSecretKey = process.env.S3_SECRET_ACCESS_KEY;

    process.env.DATABASE_URL = db.appUrl;
    process.env.BETTER_AUTH_SECRET = 'integration-test-secret-0123456789abcdef';
    process.env.JOBS_ENABLED = 'true';
    // `AppModule` construye `ObjectStorageService`, que se niega a existir sin bucket ni
    // credencial: un default acá sería un default en producción, y lo que se perdería es
    // la foto que respalda un hallazgo. Este test no toca el bucket —solo verifica el
    // orden de arranque del planificador— así que declara valores de mentira y no
    // depende del `.env` de la máquina que lo corra.
    process.env.S3_BUCKET = 'integration-test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'integration-test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'integration-test-secret';

    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication();

      await app.init();

      // El cron quedó registrado por el arranque real, no por el test.
      const schedules = await inScope<{ name: string }>(
        db.app,
        [],
        'SELECT name FROM pgboss.schedule WHERE name = $1',
        [OPEN_PERIOD_JOB],
      );

      expect(schedules).toHaveLength(1);

      await app.close();
    } finally {
      restore('DATABASE_URL', previousUrl);
      restore('BETTER_AUTH_SECRET', previousSecret);
      restore('JOBS_ENABLED', previousEnabled);
      restore('S3_BUCKET', previousBucket);
      restore('S3_ACCESS_KEY_ID', previousKeyId);
      restore('S3_SECRET_ACCESS_KEY', previousSecretKey);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
