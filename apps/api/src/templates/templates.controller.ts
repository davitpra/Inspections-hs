import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  createTemplateDraftSchema,
  saveTemplateDraftSchema,
  type TemplateDraft,
  type TemplateDraftSummary,
  type TemplateOption,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas: elegir las publicadas, y escribir las que todavía no lo son.
 *
 * `GET /templates` es de siempre y responde lo de siempre —las plantillas PUBLICADAS, para
 * que el coordinador elija una al programar—, y lo puede llamar cualquiera. No se le agregó
 * ninguna comprobación de rol: es lo que `/scheduling` consume, y gatearlo lo rompería.
 *
 * `/templates/drafts` es otra cosa, y por eso son rutas separadas y no un parámetro de la
 * misma: un borrador no es una plantilla que todavía no se puede elegir, es un documento
 * que se está escribiendo. Ninguna de sus rutas escribe una fila en `template`,
 * `template_item` ni `template_version`. **Publicar sigue sin vivir en ningún endpoint**:
 * es la segunda mitad de la etapa 8.
 *
 * Las cinco rutas de borrador son del coordinador, el `GET` incluido. El servicio lo
 * comprueba, y ahí está la única defensa que hay: `template_draft` no lleva `site_id` y por
 * lo tanto no tiene política RLS detrás (migración 0016 §5).
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  async list(@CurrentSession() session: SessionContext): Promise<TemplateOption[]> {
    return this.templates.list(session);
  }

  @Get('drafts')
  async listDrafts(@CurrentSession() session: SessionContext): Promise<TemplateDraftSummary[]> {
    return this.templates.listDrafts(session);
  }

  @Post('drafts')
  async createDraft(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<TemplateDraft> {
    return this.templates.createDraft(session, createTemplateDraftSchema.parse(body));
  }

  @Get('drafts/:id')
  async getDraft(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<TemplateDraft> {
    return this.templates.getDraft(session, id);
  }

  /**
   * `PUT` y no `PATCH`: el cuerpo trae el documento entero, no un parche. Un borrador se
   * guarda completo o no se guarda — reordenar dos secciones y agregar un ítem no es una
   * secuencia de operaciones que tenga sentido aplicar a medias.
   */
  @Put('drafts/:id')
  async saveDraft(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TemplateDraft> {
    return this.templates.saveDraft(session, id, saveTemplateDraftSchema.parse(body));
  }

  /**
   * `POST .../discard` y no `DELETE`: no se borra nada. La fila queda con `discarded_at` y
   * el verbo lo dice, para que nadie lea la ruta y suponga lo contrario de lo que pasa.
   */
  @Post('drafts/:id/discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardDraft(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.templates.discardDraft(session, id);
  }
}
