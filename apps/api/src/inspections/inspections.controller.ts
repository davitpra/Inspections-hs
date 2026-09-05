import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  assignInspectorSchema,
  cancelScheduledInspectionSchema,
  createInspectionScheduleSchema,
  createScheduledInspectionSchema,
  updateInspectionScheduleSchema,
  type InspectionSchedule,
  type InspectorOption,
  type LocationPackage,
  type PendingInspection,
  type RosterPackage,
  type ScheduledInspection,
  type SubmittedInspection,
  type TemplateVersionPackage,
} from '@hs/contracts';
import { z } from 'zod';

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

  @Post('scheduled-inspections/:id/make-visible')
  @HttpCode(HttpStatus.OK)
  async makeVisible(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<ScheduledInspection> {
    return this.inspections.makeVisible(session, id);
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
  // El paquete de campo, para el dispositivo que va a recorrer sin señal.
  //
  // Tres rutas y no una: la descarga previa las pide por separado para que un fallo
  // parcial deje evidencia de QUÉ falta. Una respuesta única solo podría fallar entera, y
  // la pantalla de preparación no podría decirle al inspector que le falta el roster.
  //
  // Las tres cuelgan de la inspección y no del recurso —no hay `GET /locations`— porque
  // así el alcance es una sola pregunta, resuelta por RLS sobre `scheduled_inspection`, y
  // porque lo que el dispositivo pide no es el catálogo sino lo que ESTA inspección
  // necesita.

  /** El documento congelado. Nunca "la versión más alta publicada". */
  @Get('scheduled-inspections/:id/template-version')
  async templateVersionPackage(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<TemplateVersionPackage> {
    return this.inspections.templateVersionPackage(session, id);
  }

  /** Avanza explícitamente la inspección a la versión publicada más alta. */
  @Post('scheduled-inspections/:id/template-version/advance')
  @HttpCode(HttpStatus.OK)
  async advanceTemplateVersion(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<TemplateVersionPackage> {
    return this.inspections.advanceTemplateVersion(session, id);
  }

  /** El catálogo cerrado de ubicaciones activas de la planta de la inspección. */
  @Get('scheduled-inspections/:id/locations')
  async locationPackage(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<LocationPackage> {
    return this.inspections.locationPackage(session, id);
  }

  /** El subconjunto activo del roster de esa misma planta. */
  @Get('scheduled-inspections/:id/roster')
  async rosterPackage(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<RosterPackage> {
    return this.inspections.rosterPackage(session, id);
  }

  /**
   * El envío aceptado, leído de vuelta: el documento congelado con el que se contestó,
   * las respuestas, y los hallazgos que abrieron.
   *
   * CUARTA HERMANA de las tres de arriba y por el mismo motivo: cuelga de la inspección
   * programada, así que el alcance es una sola pregunta que RLS ya responde sobre
   * `scheduled_inspection`. Sin comprobación de rol — quien tenga alcance a la planta
   * puede leer su registro, igual que puede leer su programación.
   *
   * Un período sin envío responde como uno que no existe (ver `active-inspection.ts`).
   */
  @Get('scheduled-inspections/:id/submission')
  async submittedInspection(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<SubmittedInspection> {
    return this.inspections.submittedInspection(session, id);
  }

  // -------------------------------------------------------------------------

  /**
   * A quién se le puede asignar una inspección en esa planta.
   *
   * Vive acá y no en un módulo de identidad porque el predicado de elegibilidad vive
   * acá, y todo el punto es que sea EL MISMO que valida la asignación.
   *
   * `site_id` por query y no por sesión: el coordinador tiene alcance a las dos plantas y
   * la lista es distinta en cada una. A diferencia del resto de este controller, que ese
   * sitio esté dentro de su alcance **sí lo comprueba el servicio**: `app_user` y
   * `user_site_scope` no llevan política de aislamiento.
   */
  @Get('inspector-candidates')
  async inspectorCandidates(
    @CurrentSession() session: SessionContext,
    @Query('site_id') siteId: unknown,
  ): Promise<InspectorOption[]> {
    return this.inspections.listInspectorCandidates(session, z.uuid().parse(siteId));
  }

  /** La pantalla de inicio del miembro del JHSC: lo que todavía debe. */
  @Get('me/pending-inspections')
  async pending(@CurrentSession() session: SessionContext): Promise<PendingInspection[]> {
    return this.inspections.pendingFor(session);
  }
}
