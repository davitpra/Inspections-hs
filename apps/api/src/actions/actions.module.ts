import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { EscalationService } from './escalation.service';

/**
 * Requisitos §7 etapa 5 — El módulo de acciones correctivas de ADR-008.
 *
 * **No importa `InspectionsModule` ni `FindingsModule`, y no exporta nada.** La
 * dependencia con `findings` es de datos —lee la clasificación vigente del hallazgo en
 * su propia consulta— y no de providers: no hay servicio de hallazgos que inyectar. Y
 * nada llama a `actions`: crear una acción es un acto del coordinador días después del
 * envío, no un paso de la transacción de ingesta.
 *
 * `EscalationService` es un provider como cualquier otro y no un módulo aparte, igual
 * que `OpenPeriodService` en inspecciones: es el mismo dominio visto desde el
 * planificador en vez de desde HTTP.
 */
@Module({
  // `JobsModule` es @Global, así que este import no hace falta para RESOLVER
  // `JobsService` — hace falta para ORDENAR el arranque. Sin esta arista, el registro
  // del cron podría correr antes de que el planificador arrancara, y el escalamiento
  // sería un trabajo que nadie consume.
  imports: [JobsModule],
  controllers: [ActionsController],
  providers: [ActionsService, EscalationService],
  exports: [EscalationService],
})
export class ActionsModule {}
