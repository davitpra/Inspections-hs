import { Logger, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

/**
 * El apagado ordenado ante SIGTERM (un redeploy) o SIGINT (Ctrl+C).
 *
 * **Por qué no `app.enableShutdownHooks()`.** Nest 11 cierra en este orden: primero los
 * `onModuleDestroy` —`JobsService` para pg-boss, `DbService` hace `pool.end()`— y DESPUÉS
 * el servidor HTTP. Entre uno y otro la API sigue aceptando requests sin base: un envío
 * que llega en ese medio segundo abre su transacción contra un pool cerrado y muere en
 * 500. La idempotencia de `client_submission_id` hace que el outbox lo reintente sin daño
 * (ADR-001), pero un redeploy no debería depender de eso para no perder requests.
 *
 * Así que el orden se invierte a mano:
 *
 *   1. `server.close()`: no se aceptan conexiones nuevas, y los requests en vuelo terminan
 *      con la base todavía abierta.
 *   2. Si pasan `graceMs` y alguno sigue, se cortan. Es un teléfono con mala señal subiendo
 *      un envío lento, y el outbox lo reintenta contra la instancia nueva.
 *   3. `app.close()`: los hooks de siempre. pg-boss espera a sus trabajos en vuelo y el pool
 *      se cierra sin nadie usándolo.
 *
 * `process.once`: un segundo Ctrl+C mata el proceso al instante, que es lo que se espera
 * de un desarrollador que ya se cansó de esperar.
 */
export function closeGracefullyOnSignals(app: INestApplication, graceMs: number): void {
  const logger = new Logger('Shutdown');
  let closing = false;

  const close = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return;
    closing = true;

    logger.log(`${signal}: dejando de aceptar conexiones.`);

    const server = app.getHttpServer() as Server;
    const deadline = setTimeout(() => {
      logger.warn(`Pasaron ${graceMs} ms con requests en vuelo: se cortan.`);
      server.closeAllConnections();
    }, graceMs);
    deadline.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearTimeout(deadline);

      await app.close();
      logger.log('Apagado completo.');
      process.exit(0);
    } catch (error) {
      logger.error('El apagado falló.', error instanceof Error ? error.stack : String(error));
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, (received) => void close(received));
  }
}
