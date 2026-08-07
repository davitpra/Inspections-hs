import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { withSiteScope, type SiteScope } from './site-scope';

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
   * Corre `run` dentro de una transacción con el alcance de sitio declarado.
   * Todo acceso a datos por sitio pasa por acá: fuera de este alcance la política
   * RLS no devuelve ninguna fila.
   */
  async withSiteScope<T>(
    scope: SiteScope,
    run: (db: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return withSiteScope(this.pool, scope, (client) => run(drizzle(client, { schema })));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
