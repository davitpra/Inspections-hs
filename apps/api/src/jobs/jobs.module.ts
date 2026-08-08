import { Global, Module } from '@nestjs/common';

import { JobsService } from './jobs.service';

/**
 * ADR-005 — El planificador, disponible para cualquier módulo que tenga trabajos.
 *
 * `@Global` porque el planificador es infraestructura, como la base: los tres trabajos
 * que ADR-005 enumera viven en tres módulos de dominio distintos, y cablear el import
 * en cada uno solo produce ceremonia.
 */
@Global()
@Module({
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
