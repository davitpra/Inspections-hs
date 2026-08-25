import { Module } from '@nestjs/common';

import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/** El módulo conserva únicamente la lectura de recurrencia (ADR-008). */
@Module({
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
