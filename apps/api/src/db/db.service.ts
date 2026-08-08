import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';

import * as schema from './schema';
import {
  withSessionScope,
  withSiteScope,
  type ReadDescriptor,
  type SessionScope,
  type SiteScope,
} from './site-scope';

/**
 * ADR-002 / ADR-004 — La API se conecta como `hs_app`: un rol sin CREATE y sin
 * UPDATE/DELETE. `MIGRATION_DATABASE_URL` nunca entra a este proceso; las
 * migraciones son un comando aparte (`pnpm db:migrate`).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL no está definida. Ver .env.example.');
    }

    this.pool = new Pool({ connectionString });
  }

  /**
   * Corre `run` dentro de una transacción con el alcance de sitio DECLARADO por el
   * llamador. Desde ADR-011 este camino es el de los seeds, los comandos de servidor
   * y los tests: cosas sin sesión detrás.
   *
   * El camino HTTP usa `withSession`, y la separación es el punto: un endpoint no
   * puede llamar a este método sin fabricar un `SiteScope`, que es un acto visible en
   * el diff y no un parámetro opcional que se pasa por error.
   */
  async withSiteScope<T>(
    scope: SiteScope,
    run: (db: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return withSiteScope(this.pool, scope, (client) => run(drizzle(client, { schema })));
  }

  /**
   * El mismo alcance declarado, pero con el cliente crudo en vez del constructor de
   * Drizzle. Lo usa la administración de cuentas, que escribe SQL a mano contra tablas
   * sin política RLS y necesita el alcance solo para que los triggers de auditoría
   * encuentren la planta declarada.
   */
  async withSiteScopeClient<T>(
    scope: SiteScope,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return withSiteScope(this.pool, scope, run);
  }

  /**
   * ADR-011 — El alcance derivado de la sesión, que es por donde pasa todo request
   * autenticado. Fija además la ventana de fechas del auditor externo y, para ese
   * rol, escribe la entrada de lectura en la misma transacción (design D10).
   */
  async withSession<T>(
    session: SessionScope,
    run: (db: NodePgDatabase<typeof schema>) => Promise<T>,
    read?: ReadDescriptor,
  ): Promise<T> {
    return withSessionScope(
      this.pool,
      session,
      (client) => run(drizzle(client, { schema })),
      read,
    );
  }

  /**
   * El pool crudo, para lo que corre ANTES de que exista un alcance: la resolución
   * del token, la rotación del refresh y la revocación. Ninguna de esas tablas lleva
   * política RLS —una política sobre el alcance que se lee para CONSTRUIR el alcance
   * es un arranque circular— y por eso no pasan por los dos métodos de arriba.
   */
  get unscopedPool(): Pool {
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
