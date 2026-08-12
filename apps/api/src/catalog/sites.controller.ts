import { Controller, Get } from '@nestjs/common';
import type { Site } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { SitesService } from './sites.service';

/** Las plantas del alcance de la sesión. Sin parámetros: el alcance no se pide, se tiene. */
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  async list(@CurrentSession() session: SessionContext): Promise<Site[]> {
    return this.sites.list(session);
  }
}
