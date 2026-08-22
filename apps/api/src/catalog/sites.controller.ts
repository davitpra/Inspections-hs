import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createSiteSchema,
  deactivateSiteSchema,
  type CreateSite,
  type Site,
  updateSiteSchema,
} from '@hs/contracts';

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

  @Patch(':siteId')
  update(
    @CurrentSession() session: SessionContext,
    @Param('siteId', new ParseUUIDPipe()) siteId: string,
    @Body() body: unknown,
  ): Promise<Site> {
    return this.sites.update(session, siteId, updateSiteSchema.parse(body));
  }

  @Post(':siteId/deactivate')
  deactivate(
    @CurrentSession() session: SessionContext,
    @Param('siteId', new ParseUUIDPipe()) siteId: string,
    @Body() body: unknown,
  ): Promise<Site> {
    deactivateSiteSchema.parse(body);
    return this.sites.deactivate(session, siteId);
  }
}
