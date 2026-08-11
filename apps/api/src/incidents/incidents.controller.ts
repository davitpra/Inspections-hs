import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  incidentTransitionRequestSchema,
  recordCauseRequestSchema,
  reportIncidentRequestSchema,
  type Form7Mapping,
  type Incident,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { IncidentsService } from './incidents.service';

/**
 * Requisitos §3 R4 — El reporte de incidente en tercera persona.
 *
 * **No hay `PATCH` ni `DELETE`, y no hay ruta para reclasificar ni para corregir la
 * narrativa.** Las cinco tablas son inmutables: avanzar un incidente es un `POST` que
 * agrega un evento. §4 ya tiene la respuesta a "me equivoqué" y se llama
 * `RegistroSuplementario` —entrada adicional con `supersedes_id`, autor y motivo, con el
 * original visible y marcado como superado—, y no existe todavía.
 *
 * **No hay ruta sin sesión, ni de kiosco, ni con link compartible, y esas ausencias son
 * el requisito.** El reporte anónimo, el formulario público y la primera persona están
 * fuera de alcance de v1 por decisión explícita: la trazabilidad del autor es lo que
 * hace que el registro sirva ante el MLITSD.
 *
 * **No hay ruta para subir una foto.** El incidente no acepta adjuntos: la foto de una
 * persona accidentada es detalle clínico por otra puerta (riesgo G-bis). La evidencia de
 * la remediación vive en las acciones correctivas de la investigación.
 *
 * **No hay ruta que envíe nada al MLITSD ni al WSIB.** `GET /incidents/:id/form7`
 * devuelve valores para una pantalla de solo lectura; presentar es un acto de una
 * persona.
 *
 * Ninguna ruta acepta un actor, un sitio ni un rol: salen de la sesión.
 */
@Controller()
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get('incidents')
  async list(@CurrentSession() session: SessionContext): Promise<Incident[]> {
    return this.incidents.list(session);
  }

  @Get('incidents/:id')
  async get(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<Incident> {
    return this.incidents.get(session, id);
  }

  @Post('incidents')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<Incident> {
    return this.incidents.report(session, reportIncidentRequestSchema.parse(body));
  }

  /**
   * Investigar, cerrar y reabrir, todo por la misma ruta.
   *
   * Una ruta y no tres, igual que en acciones: las tres son insertar un evento, y cuál
   * de ellas es lo decide el estado vigente junto con el destino pedido — no el cliente
   * eligiendo un verbo.
   *
   * `201`: se creó un evento. Que ese evento cierre el incidente es una consecuencia, no
   * un status distinto.
   */
  @Post('incidents/:id/transitions')
  @HttpCode(HttpStatus.CREATED)
  async transition(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Incident> {
    return this.incidents.transition(session, id, incidentTransitionRequestSchema.parse(body));
  }

  /** Agregar una causa. Corregir una causa es agregar otra: no hay `PATCH`. */
  @Post('incidents/:id/investigation/causes')
  @HttpCode(HttpStatus.CREATED)
  async recordCause(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Incident> {
    return this.incidents.recordCause(session, id, recordCauseRequestSchema.parse(body));
  }

  /**
   * Los valores del incidente mapeados a los campos del Form 7 del WSIB.
   *
   * Solo lectura, y **no genera el PDF oficial** (riesgo H). El mapeo sale de la versión
   * del formulario de ESTE incidente, así que uno viejo se mapea con el conjunto de
   * campos que tenía. Los campos que el sistema deliberadamente no almacena viajan
   * marcados como tales, para que la pantalla no los muestre como vacíos.
   */
  @Get('incidents/:id/form7')
  async form7(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<{ incident: Incident; mapping: Form7Mapping }> {
    return this.incidents.form7(session, id);
  }
}
