import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createLocationSchema,
  createOrganizationLocationSchema,
  deactivateOrganizationLocationSchema,
  locationOrganizationMappingSchema,
  type Location,
  type OrganizationLocation,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { LocationsService } from './locations.service';

/**
 * El catálogo de ubicaciones: las compartidas de la organización y las físicas de cada
 * planta, más el mapeo entre unas y otras.
 *
 * **La planta va en la RUTA y nunca en el cuerpo** (`POST /sites/:siteId/locations`).
 * `createLocationSchema` es un `strictObject` sin `site_id` y hay un test de contratos que
 * lo mantiene así: con la planta adentro del payload, el objeto que se valida y el
 * aislamiento que se aplica pasarían a parecer lo mismo, y ADR-004 pide justo lo contrario.
 * El sitio de la ruta es selección entre el alcance; el límite lo pone RLS.
 */
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('organization-locations')
  listOrganizationLocations(
    @CurrentSession() session: SessionContext,
  ): Promise<OrganizationLocation[]> {
    return this.locations.listOrganizationLocations(session);
  }

  @Get('locations')
  listLocations(@CurrentSession() session: SessionContext): Promise<Location[]> {
    return this.locations.listLocations(session);
  }

  @Post('organization-locations')
  createOrganizationLocation(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<OrganizationLocation> {
    return this.locations.createOrganizationLocation(
      session,
      createOrganizationLocationSchema.parse(body),
    );
  }

  @Post('sites/:siteId/locations')
  createLocation(
    @CurrentSession() session: SessionContext,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ): Promise<Location> {
    return this.locations.createLocation(session, siteId, createLocationSchema.parse(body));
  }

  @Patch('organization-locations/:id')
  deactivateOrganizationLocation(
    @CurrentSession() session: SessionContext,
    @Param('id') organizationLocationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    deactivateOrganizationLocationSchema.parse(body);
    return this.locations.deactivateOrganizationLocation(session, organizationLocationId);
  }

  @Patch('locations/:id/organization-location')
  map(
    @CurrentSession() session: SessionContext,
    @Param('id') locationId: string,
    @Body() body: unknown,
  ): Promise<Location> {
    const input = locationOrganizationMappingSchema.parse(body);
    return this.locations.mapLocation(session, locationId, input.organization_location_id);
  }
}
