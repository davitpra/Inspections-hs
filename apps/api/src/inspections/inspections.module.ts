import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { OpenPeriodService } from './open-period.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

/**
 * Requisitos §4 — La obligación de inspeccionar.
 *
 * `OpenPeriodService` es un provider como cualquier otro y no un módulo aparte: es el
 * mismo dominio visto desde el planificador en vez de desde HTTP, y separarlo obligaría
 * a exportar el servicio para que el trabajo lo use.
 */
@Module({
  // `JobsModule` es @Global, así que este import no hace falta para RESOLVER
  // `JobsService` — hace falta para ORDENAR el arranque. Nest corre los hooks de un
  // módulo después de los de aquellos que importa, y sin esta arista el registro del
  // cron podría ejecutarse antes de que el planificador arrancara.
  imports: [JobsModule],
  controllers: [InspectionsController, SubmissionsController],
  providers: [InspectionsService, OpenPeriodService, SubmissionsService],
  exports: [InspectionsService, OpenPeriodService, SubmissionsService],
})
export class InspectionsModule {}
