import { Module } from '@nestjs/common';

import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas: el catálogo de lectura y la autoría en borrador.
 *
 * Sigue sin haber repositorio inyectable: `templates.repository.ts` son funciones sueltas
 * que reciben el `PoolClient`, como en `roster`. La capa es delgada a propósito (ADR-008).
 *
 * **La publicación sigue sin vivir acá y sin vivir en ningún endpoint.** Escribir un
 * borrador no escribe una `template_version`, y `hs_app` sigue sin tener INSERT sobre las
 * cuatro tablas del modelo publicado: la migración 0016 no las tocó. Es la segunda mitad de
 * la etapa 8.
 */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
