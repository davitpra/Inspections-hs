import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ComplianceService } from './compliance.service';
import { PdfRendererService } from './pdf-renderer';
import { RenderComplianceService } from './render-compliance.service';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/**
 * Requisitos §7 etapa 7 — El módulo de recurrencia y de cumplimiento (ADR-008).
 *
 * **No importa `FindingsModule` y no exporta nada** (design D10 de `recurrence-detection`).
 * Lee `finding` directamente con consultas de agregación: componer sobre `FindingsService`
 * sería traer hallazgos completos —con sus fotos y su clasificación vigente— a Node para
 * contarlos, que es contar en el lugar equivocado.
 *
 * SÍ IMPORTA `JobsModule` Y `UploadsModule`, y las dos importaciones son requisitos y no
 * comodidad:
 *
 *   - `JobsModule` porque `RenderComplianceService` registra un handler en el arranque, y
 *     `JobsService.work` lanza si el planificador todavía no arrancó. El grafo de
 *     dependencias es lo que garantiza ese orden; el orden de los `imports` de
 *     `app.module.ts` no garantizaría nada.
 *   - `UploadsModule` porque el PDF se sube y se descarga por el mismo servicio de
 *     almacenamiento que las fotos. Un segundo cliente de S3 sería una segunda credencial
 *     que alguien tendría que acordarse de dejar sin `DeleteObject`.
 *
 * La dirección de ADR-008 se mantiene en el otro sentido: **nadie importa este módulo**.
 */
@Module({
  imports: [JobsModule, UploadsModule],
  controllers: [ReportingController],
  providers: [ReportingService, ComplianceService, PdfRendererService, RenderComplianceService],
})
export class ReportingModule {}
