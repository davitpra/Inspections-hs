import { Controller, Get, Query } from '@nestjs/common';
import { recurrenceQuerySchema, type RecurrenceReport } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { ReportingService } from './reporting.service';

@Controller()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('findings/recurrence')
  async recurrence(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<RecurrenceReport> {
    return this.reporting.recurrence(session, recurrenceQuerySchema.parse(query ?? {}));
  }
}
