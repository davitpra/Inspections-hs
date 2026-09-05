import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  createActionRequestSchema,
  replaceActionAssignmentRequestSchema,
  transitionRequestSchema,
  type Action,
  type ActionSummary,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { ActionsService } from './actions.service';

/**
 * Requisitos §3 R3 — El cierre verificado de la acción.
 *
 * Avanzar agrega un evento; la asignación operativa se reemplaza entera hasta que el
 * trabajo se declara hecho, cuando la guarda del motor la congela (ADR-021). DELETE no
 * existe.
 *
 * **Tampoco hay ruta para escalar.** El escalamiento es del planificador y no de una
 * persona: si existiera un `POST /actions/:id/escalate`, existiría la posibilidad de
 * escalar algo que no está vencido, y el escalamiento dejaría de ser un hecho sobre el
 * plazo para pasar a ser una opinión.
 *
 * Ninguna ruta acepta un actor: sale de la sesión.
 */
@Controller()
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Get('actions')
  async list(@CurrentSession() session: SessionContext): Promise<ActionSummary[]> {
    return this.actions.list(session);
  }

  @Get('actions/:id')
  async get(@CurrentSession() session: SessionContext, @Param('id') id: string): Promise<Action> {
    return this.actions.get(session, id);
  }

  /**
   * Abrir una acción sobre un hallazgo. Cuelga del hallazgo en la ruta porque cuelga de
   * él en el modelo: §4 fija que una acción pertenece a exactamente un padre, y un
   * `POST /actions` con un `finding_id` en el cuerpo dejaría esa relación como un campo
   * opcional más.
   */
  @Post('findings/:id/actions')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentSession() session: SessionContext,
    @Param('id') findingId: string,
    @Body() body: unknown,
  ): Promise<Action> {
    return this.actions.create(session, findingId, createActionRequestSchema.parse(body));
  }

  /**
   * Abrir una acción sobre una investigación (§4, etapa 6). El segundo padre de §4,
   * colgado de la ruta por lo mismo que el primero.
   *
   * Usa el mismo contrato que la ruta de hallazgos: el coordinador declara `due_at`.
   */
  @Post('investigations/:id/actions')
  @HttpCode(HttpStatus.CREATED)
  async createForInvestigation(
    @CurrentSession() session: SessionContext,
    @Param('id') investigationId: string,
    @Body() body: unknown,
  ): Promise<Action> {
    return this.actions.createForInvestigation(
      session,
      investigationId,
       createActionRequestSchema.parse(body),
    );
  }

  /**
   * Reemplaza la asignación vigente completa mientras el trabajo no se declaró hecho
   * (ADR-021).
   */
  @Put('actions/:id/assignment')
  async replaceAssignment(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Action> {
    return this.actions.replaceAssignment(
      session,
      id,
      replaceActionAssignmentRequestSchema.parse(body),
    );
  }

  /**
   * Empezar, declarar hecho, verificar y rechazar, todo por la misma ruta.
   *
   * Una ruta y no cuatro: las cuatro son insertar un evento, y cuál de ellas es lo
   * decide el estado vigente junto con el destino pedido — no el cliente eligiendo un
   * verbo. Cuatro rutas habrían dejado a la UI decidiendo cuál llamar, con la respuesta
   * a esa pregunta en la base.
   *
   * `201`: se creó un evento. Que ese evento cierre la acción es una consecuencia, no
   * un status distinto.
   */
  @Post('actions/:id/transitions')
  @HttpCode(HttpStatus.CREATED)
  async transition(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Action> {
    return this.actions.transition(session, id, transitionRequestSchema.parse(body));
  }
}
