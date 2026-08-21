import { Body, Controller, Get, Post } from '@nestjs/common';
import { createSiteSchema, type CreateSite, type Site } from '@hs/contracts';

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

  @Post()
  create(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<Site> {
    return this.sites.create(session, createSiteSchema.parse(body) as CreateSite);
  }
}
