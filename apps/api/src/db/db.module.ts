import { Global, Module } from '@nestjs/common';

import { DbService } from './db.service';

/**
 * Global porque el pool es uno solo para todo el proceso: cada módulo que
 * importara el suyo abriría conexiones de más contra el mismo Postgres.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
