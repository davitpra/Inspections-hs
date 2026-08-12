import { Controller, Get } from '@nestjs/common';
import type { TemplateOption } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas, para ELEGIRLAS. No para editarlas: el builder visual es la etapa 8 y
 * hasta entonces las plantillas se cargan como seeds en SQL, a propósito.
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  async list(@CurrentSession() session: SessionContext): Promise<TemplateOption[]> {
    return this.templates.list(session);
  }
}
