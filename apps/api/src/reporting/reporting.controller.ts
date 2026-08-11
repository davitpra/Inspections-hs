import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  complianceQuerySchema,
  recurrenceQuerySchema,
  type ComplianceReport,
  type ComplianceReportSummary,
  type ComplianceView,
  type RecurrenceReport,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { ComplianceService } from './compliance.service';
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
  constructor(
    private readonly reporting: ReportingService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('findings/recurrence')
  async recurrence(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<RecurrenceReport> {
    return this.reporting.recurrence(session, recurrenceQuerySchema.parse(query ?? {}));
  }

  /**
   * §3 R5 — La cobertura del rango, calculada al vuelo. No congela nada y no devuelve
   * digest: un número que cambia con el próximo envío no es evidencia de nada.
   */
  @Get('reports/compliance')
  async coverage(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<ComplianceView> {
    return this.compliance.coverage(session, complianceQuerySchema.parse(query ?? {}));
  }

  /** Los reportes ya generados de una planta, sin su payload. */
  @Get('reports/compliance/list')
  async list(
    @CurrentSession() session: SessionContext,
    @Query('site_id') siteId: string,
  ): Promise<ComplianceReportSummary[]> {
    return this.compliance.listReports(session, siteId);
  }

  /**
   * Congela el reporte y encola su render.
   *
   * **Responde antes de que el PDF exista**, con el reporte y su digest ya guardados. Es
   * la asimetría del change: la evidencia se crea en la transacción; el archivo es una
   * vista de esa evidencia y puede llegar después, o fallar y reintentarse.
   */
  @Post('reports/compliance')
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<ComplianceReport> {
    return this.compliance.generate(session, complianceQuerySchema.parse(body));
  }

  @Get('reports/compliance/:id')
  async get(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<ComplianceReport> {
    return this.compliance.getReport(session, id);
  }

  /**
   * La descarga: la URL firmada, no los bytes.
   *
   * **DEVUELVE JSON Y NO UNA REDIRECCIÓN**, y la diferencia la impone la autenticación:
   * la sesión viaja como `Authorization: Bearer`, así que un `<a href>` del navegador
   * llegaría sin token y comería un 401. El cliente pide la URL con su token, y después
   * abre la URL firmada —que no necesita sesión— contra el bucket. El PDF sigue sin
   * atravesar el proceso de Node, que es lo que importaba.
   *
   * OJO CON EL ORDEN DE RUTAS, por lo mismo que arriba: `reports/compliance/list` está
   * declarada ANTES que `reports/compliance/:id`, o el literal se lo come el parámetro y
   * listar respondería «no such report».
   */
  @Get('reports/compliance/:id/pdf')
  async download(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<{ url: string; expires_at: string }> {
    const download = await this.compliance.downloadUrl(session, id);

    return { url: download.url, expires_at: download.expires_at };
  }
}
