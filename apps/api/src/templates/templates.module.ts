import { Module } from '@nestjs/common';

import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas: el catálogo de lectura y la autoría en borrador.
 *
 * Sigue sin haber repositorio inyectable: `templates.repository.ts` son funciones sueltas
 * que reciben el `PoolClient`, como en `roster`. La capa es delgada a propósito (ADR-008).
 *
 * La publicación vive en el servicio y el endpoint como una operación atómica. El repositorio
 * sigue siendo un conjunto de funciones SQL que recibe el cliente de la transacción.
 */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
