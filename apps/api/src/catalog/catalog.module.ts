import { Module } from '@nestjs/common';

import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

/**
 * El catálogo de la organización. Hoy solo las plantas: las ubicaciones se sirven
 * atadas a una inspección, desde el paquete de campo, porque ahí es donde se usan.
 */
@Module({
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class CatalogModule {}
