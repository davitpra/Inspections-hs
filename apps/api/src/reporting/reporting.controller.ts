import { Controller, Get, Query } from '@nestjs/common';
import { recurrenceQuerySchema, type RecurrenceReport } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { ReportingService } from './reporting.service';

/**
 * Requisitos §7 etapa 7 — La recurrencia, de solo lectura.
 *
 * **Solo hay `GET`, y esa ausencia de verbos es el diseño.** Una serie no se crea, no se
 * cierra y no se marca como atendida: es lo que los hallazgos dicen cuando se los agrupa,
 * y el día en que alguien pudiera "cerrar" una serie el número dejaría de significar lo
 * que dice. Lo que se atiende es la acción correctiva de cada hallazgo, que ya existe.
 *
 * **Sin comprobación de rol.** Todo rol con alcance lee su recurrencia; qué sitios entran
 * lo decide la sesión y lo aplica la política RLS.
 *
 * OJO CON EL ORDEN DE RUTAS: `findings/recurrence` tiene que resolverse ANTES que
 * `findings/:id` de `FindingsController`, o el literal se lo come el parámetro. Lo
 * garantiza el orden de `imports` en `app.module.ts` —`ReportingModule` va antes que
 * `FindingsModule`— y lo verifica un test de integración, porque un orden que solo se
 * sostiene por convención es un orden que alguien reordena alfabetizando.
 */
@Controller()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('findings/recurrence')
  async recurrence(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<RecurrenceReport> {
    return this.reporting.recurrence(session, recurrenceQuerySchema.parse(query ?? {}));
  }
}
