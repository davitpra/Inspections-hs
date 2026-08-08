import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import type { JobName, JobPayloads } from './job-registry';

/**
 * ADR-005 — El planificador, sobre la misma Postgres. Sin Redis.
 *
 * Se conecta como `hs_app`, igual que el resto de la API. El esquema `pgboss` lo crea
 * `pnpm db:jobs:install` con `hs_migrator`, que es un paso de despliegue y no parte
 * del arranque: `DbService` tiene escrito que `MIGRATION_DATABASE_URL` nunca entra a
 * este proceso, y traer una conexión de dueño para instalar una vez lo violaría por
 * comodidad. Este servicio VERIFICA que el esquema esté, y si no está falla ruidoso —
 * un worker que arranca contra un esquema ausente y se queda callado es peor que uno
 * que no arranca.
 *
 * `onApplicationBootstrap` y no `onModuleInit`: los trabajos se registran cuando el
 * resto de los módulos ya está construido, así que un handler que se dispara en el
 * primer tick encuentra sus dependencias listas.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;
  private readonly enabled: boolean;
  private started = false;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL no está definida. Ver .env.example.');
    }

    // La salida para los tests de endpoint y para un proceso que solo sirve HTTP: sin
    // ella, cada suite levantaría un planificador que nadie usa y que hay que parar.
    this.enabled = process.env.JOBS_ENABLED !== 'false';

    this.boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      // Un cron diario sobre decenas de filas. Dos conexiones son de sobra, y mantenerlo
      // bajo es lo que evita que el planificador le coma el pool a los requests.
      max: 2,
    });

    // pg-boss emite `error` en fallos de fondo (mantenimiento, reconexión). Un
    // EventEmitter sin listener de `error` tumba el proceso, así que esto no es
    // logging decorativo: es lo que evita que una desconexión momentánea de la base
    // mate la API entera.
    this.boss.on('error', (error) => this.logger.error('pg-boss', error));
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('JOBS_ENABLED=false: el planificador no arranca.');
      return;
    }

    await this.boss.start();
    this.started = true;

    if (!(await this.boss.isInstalled())) {
      throw new Error(
        'El esquema `pgboss` no está instalado. Correr `pnpm db:jobs:install` antes de arrancar.',
      );
    }
  }

  /**
   * Declara una cola y engancha su handler. Idempotente: `createQueue` sobre una cola
   * que ya existe no falla, que es lo que permite que dos réplicas arranquen sin
   * coordinarse.
   */
  async work<N extends JobName>(
    name: N,
    handler: (payload: JobPayloads[N]) => Promise<void>,
  ): Promise<void> {
    if (!this.requireStarted(name)) return;

    await this.boss.createQueue(name);

    await this.boss.work<JobPayloads[N]>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  /**
   * Registra el cron de una cola.
   *
   * `tz` no es opcional en la práctica: el período de una inspección es una fecha
   * civil de Ontario, y sin zona el cron de la madrugada abre el mes equivocado.
   */
  async schedule<N extends JobName>(
    name: N,
    cron: string,
    timeZone: string,
    data: JobPayloads[N],
  ): Promise<void> {
    if (!this.requireStarted(name)) return;

    await this.boss.createQueue(name);

    // `schedule` es un upsert por nombre de cola: un despliegue que cambia el cron lo
    // reemplaza en vez de acumular dos.
    await this.boss.schedule(name, cron, data, {
      tz: timeZone,
      // Evita el trabajo redundante cuando corren dos réplicas. NO es la garantía de
      // idempotencia — esa es el único parcial de `scheduled_inspection`, porque un
      // trabajo que falló a mitad de camino se reintenta y tiene que poder completar.
      singletonKey: name,
    });
  }

  /** Encola una ejecución fuera del calendario. La usan los tests y la recuperación. */
  async send<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    if (!this.requireStarted(name)) return;

    await this.boss.createQueue(name);
    await this.boss.send(name, data);
  }

  /**
   * `false` cuando el planificador está apagado a propósito; excepción cuando está
   * encendido y todavía no arrancó.
   *
   * La distinción es la que evita el fallo silencioso que este servicio existe para no
   * tener: registrar un trabajo antes de `onApplicationBootstrap` lo perdería sin decir
   * nada, y el síntoma sería un cron que nunca corre. Con la excepción, un módulo que se
   * cuele antes en el orden de arranque rompe el arranque en vez de romper el mes que
   * viene. `InspectionsModule` importa `JobsModule` explícitamente para que ese orden
   * esté garantizado por el grafo y no por la casualidad de cómo se listaron los
   * imports.
   */
  private requireStarted(name: JobName): boolean {
    if (this.started) return true;
    if (!this.enabled) return false;

    throw new Error(
      `El trabajo "${name}" se registró antes de que el planificador arrancara. ` +
        'El módulo que lo registra tiene que importar JobsModule.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.started) return;

    // Ordenada: espera a que los trabajos en vuelo terminen antes de soltar el pool.
    // Sin esto, parar la API a mitad de una apertura dejaría el trabajo en `active`
    // hasta que expire, y el período no se abriría hasta el reintento.
    await this.boss.stop({ graceful: true });
    this.started = false;
  }
}
