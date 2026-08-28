import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { manualFindingRequestSchema, type Finding } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { FindingsService } from './findings.service';

/**
 * Requisitos §3 R2 — El hallazgo.
 *
 * **No hay ruta para derivar un hallazgo de una inspección, y esa ausencia es el
 * diseño.** Un hallazgo derivado aparece por la ingesta del envío y por ningún otro
 * camino: si existiera un `POST` que lo crea suelto, existiría la posibilidad de una
 * inspección con hallazgos que sus respuestas no implican.
 *
 * Tampoco hay `PATCH` ni `DELETE`: los hallazgos son inmutables y no se borran.
 *
 * Ninguna ruta acepta un actor: sale de la sesión.
 */
@Controller()
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get('findings')
  async list(@CurrentSession() session: SessionContext): Promise<Finding[]> {
    return this.findings.list(session);
  }

  @Get('findings/:id')
  async get(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<Finding> {
    return this.findings.get(session, id);
  }

  /** El peligro visto fuera de una inspección (§5 riesgo F). */
  @Post('findings')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<Finding> {
    return this.findings.report(session, manualFindingRequestSchema.parse(body));
  }

}
