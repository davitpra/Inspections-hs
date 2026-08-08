import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  assignInspectorSchema,
  cancelScheduledInspectionSchema,
  createInspectionScheduleSchema,
  createScheduledInspectionSchema,
  updateInspectionScheduleSchema,
  type InspectionSchedule,
  type PendingInspection,
  type ScheduledInspection,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { InspectionsService } from './inspections.service';

/**
 * Requisitos §4 — La programación de inspecciones.
 *
 * NINGUNA ruta acepta un actor: sale de la sesión. Las que aceptan `site_id` lo hacen
 * porque el coordinador tiene alcance a las dos plantas y tiene que poder decir cuál —
 * y que esa planta esté dentro de su alcance NO lo comprueba el endpoint, lo aplica la
 * política RLS. Un `site_id` ajeno no inserta nada.
 */
@Controller()
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  // -------------------------------------------------------------------------
  // Reglas de recurrencia — solo el coordinador

  @Get('inspection-schedules')
  async listSchedules(@CurrentSession() session: SessionContext): Promise<InspectionSchedule[]> {
    return this.inspections.listSchedules(session);
  }

  @Post('inspection-schedules')
  @HttpCode(HttpStatus.CREATED)
  async createSchedule(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<InspectionSchedule> {
    return this.inspections.createSchedule(session, createInspectionScheduleSchema.parse(body));
  }

  @Patch('inspection-schedules/:id')
  async updateSchedule(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<InspectionSchedule> {
    return this.inspections.updateSchedule(session, id, updateInspectionScheduleSchema.parse(body));
  }

  // -------------------------------------------------------------------------
  // Inspecciones programadas

  @Get('scheduled-inspections')
  async listScheduled(@CurrentSession() session: SessionContext): Promise<ScheduledInspection[]> {
    return this.inspections.listScheduled(session);
  }

  /** Programación fuera del calendario. La versión la resuelve el servidor. */
  @Post('scheduled-inspections')
  @HttpCode(HttpStatus.CREATED)
  async schedule(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<ScheduledInspection> {
    return this.inspections.schedule(session, createScheduledInspectionSchema.parse(body));
  }

  @Patch('scheduled-inspections/:id/inspector')
  async assignInspector(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScheduledInspection> {
    const { inspector_id } = assignInspectorSchema.parse(body);

    return this.inspections.assignInspector(session, id, inspector_id);
  }

  /**
   * Cancelar, con motivo obligatorio. No hay ruta para des-cancelar: el trigger de
   * guarda la rechazaría, y lo que corresponde es programar el período de nuevo.
   */
  @Post('scheduled-inspections/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScheduledInspection> {
    const { reason } = cancelScheduledInspectionSchema.parse(body);

    return this.inspections.cancel(session, id, reason);
  }

  // -------------------------------------------------------------------------

  /** La pantalla de inicio del miembro del JHSC: lo que todavía debe. */
  @Get('me/pending-inspections')
  async pending(@CurrentSession() session: SessionContext): Promise<PendingInspection[]> {
    return this.inspections.pendingFor(session);
  }
}
