import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  manualFindingRequestSchema,
  riskAssessmentRequestSchema,
  type Finding,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { FindingsService } from './findings.service';

/**
 * Requisitos §3 R2 — Del hallazgo a su clasificación.
 *
 * **No hay ruta para derivar un hallazgo de una inspección, y esa ausencia es el
 * diseño.** Un hallazgo derivado aparece por la ingesta del envío y por ningún otro
 * camino: si existiera un `POST` que lo crea suelto, existiría la posibilidad de una
 * inspección con hallazgos que sus respuestas no implican.
 *
 * Tampoco hay `PATCH` ni `DELETE`. Las tres tablas son inmutables: reclasificar es un
 * `POST` que agrega una fila, y un hallazgo no se borra nunca.
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

  /** El peligro visto fuera de una inspección (§5 riesgo F). Nace clasificado. */
  @Post('findings')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<Finding> {
    return this.findings.report(session, manualFindingRequestSchema.parse(body));
  }

  /**
   * Clasificar y reclasificar, por la misma ruta: las dos son insertar una fila, y
   * cuál de las dos es lo decide el estado del hallazgo y no el cliente.
   *
   * `201` en las dos: se creó una clasificación. Que supere a otra es una relación
   * entre filas, no un status distinto.
   */
  @Post('findings/:id/risk-assessments')
  @HttpCode(HttpStatus.CREATED)
  async classify(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Finding> {
    return this.findings.classify(session, id, riskAssessmentRequestSchema.parse(body));
  }
}
