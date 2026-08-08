import { DbService } from '../../src/db/db.service';
import { InspectionsService } from '../../src/inspections/inspections.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { OpenPeriodService } from '../../src/inspections/open-period.service';
import { JobsService } from '../../src/jobs/jobs.service';

/**
 * Los servicios reales de programación, cableados contra el contenedor del test.
 *
 * Se construyen a mano en vez de levantar el contenedor de Nest, con el mismo criterio
 * que `createAuthStack`: lo que estos specs prueban es el comportamiento de los
 * servicios y del motor, no el cableado de la inyección de dependencias. Las clases son
 * las mismas que corren en producción.
 */
export interface SchedulingStack {
  db: DbService;
  inspections: InspectionsService;
  notifications: NotificationsService;
  openPeriod: OpenPeriodService;
  jobs: JobsService;
  stop: () => Promise<void>;
}

export function createSchedulingStack(appUrl: string): SchedulingStack {
  const previous = process.env.DATABASE_URL;
  const previousEnabled = process.env.JOBS_ENABLED;

  process.env.DATABASE_URL = appUrl;
  // El planificador no arranca en este stack: los tests invocan el handler
  // directamente. Esperar a un cron para probar la apertura convertiría una aserción
  // en una espera, y la propiedad que importa —la idempotencia— no depende del reloj.
  process.env.JOBS_ENABLED = 'false';

  const db = new DbService();
  const jobs = new JobsService();

  process.env.DATABASE_URL = previous;
  if (previousEnabled === undefined) delete process.env.JOBS_ENABLED;
  else process.env.JOBS_ENABLED = previousEnabled;

  return {
    db,
    jobs,
    inspections: new InspectionsService(db),
    notifications: new NotificationsService(db),
    openPeriod: new OpenPeriodService(db, jobs),
    stop: () => db.onModuleDestroy(),
  };
}

/** El planificador de verdad, arrancado. Solo para el spec de ciclo de vida. */
export function createRunningJobs(appUrl: string): JobsService {
  const previous = process.env.DATABASE_URL;
  const previousEnabled = process.env.JOBS_ENABLED;

  process.env.DATABASE_URL = appUrl;
  process.env.JOBS_ENABLED = 'true';

  const jobs = new JobsService();

  process.env.DATABASE_URL = previous;
  if (previousEnabled === undefined) delete process.env.JOBS_ENABLED;
  else process.env.JOBS_ENABLED = previousEnabled;

  return jobs;
}

/** La sesión que un endpoint recibiría del guard, armada a mano. */
export function sessionFor(
  userId: string,
  role: string,
  siteIds: readonly string[],
): { userId: string; role: string; siteIds: readonly string[] } {
  return { userId, role, siteIds };
}
