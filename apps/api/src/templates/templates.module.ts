import { Module } from '@nestjs/common';

import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas como catálogo de lectura. La publicación no vive acá y no vive en
 * ningún endpoint: es la etapa 8.
 */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
