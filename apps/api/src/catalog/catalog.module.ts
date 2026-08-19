import { Module } from '@nestjs/common';

import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

/**
 * El catálogo de la organización: plantas, ubicaciones físicas y sus ubicaciones
 * conceptuales compartidas.
 */
@Module({
  controllers: [SitesController, LocationsController],
  providers: [SitesService, LocationsService],
  exports: [SitesService, LocationsService],
})
export class CatalogModule {}
