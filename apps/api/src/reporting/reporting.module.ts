import { Module } from '@nestjs/common';

import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/**
 * Requisitos §7 etapa 7 — El módulo de recurrencia de ADR-008.
 *
 * **No importa `FindingsModule` y no exporta nada** (design D10). Lee `finding`
 * directamente con una consulta de agregación: componer sobre `FindingsService` sería
 * traer hallazgos completos —con sus fotos y su clasificación vigente— a Node para
 * contarlos, que es contar en el lugar equivocado.
 *
 * La dirección de ADR-008 se mantiene en el otro sentido también: **nadie importa este
 * módulo**. La marca que se escribe durante la ingesta no sale de acá; vive en
 * `findings/recurrence.ts`, porque es parte de la transacción de ingesta y no del
 * reporte.
 */
@Module({
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
