import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  createTemplateDraftSchema,
  deactivateTemplateSchema,
  type PublishedTemplate,
  type PublishedTemplateSummary,
  type PublishedTemplateVersion,
  reactivateTemplateSchema,
  saveTemplateDraftSchema,
  type TemplateDraft,
  type TemplateDraftSummary,
  type TemplateOption,
} from '@hs/contracts';
import { z } from 'zod';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { TemplatesService } from './templates.service';

/**
 * Las plantillas: elegir, leer las publicadas, y escribir las que todavía no lo son.
 *
 * `GET /templates` es de siempre y responde lo de siempre —las plantillas PUBLICADAS, para
 * que el coordinador elija una al programar—, y lo puede llamar cualquiera. No se le agregó
 * ninguna comprobación de rol: es lo que `/scheduling` consume, y gatearlo lo rompería.
 *
 * `GET /templates/published` es OTRA pregunta sobre las mismas filas —el catálogo tal como
 * se ADMINISTRA, retiradas incluidas— y por eso es del coordinador. Junto con
 * `POST :id/deactivate` y `POST :id/reactivate` forman la consola: retirar una plantilla la
 * saca de lo que se puede programar sin borrar nada y sin tocar lo ya programado.
 *
 * `/templates/drafts` es otra cosa, y por eso son rutas separadas y no un parámetro de la
 * misma: un borrador no es una plantilla que todavía no se puede elegir, es un documento
 * que se está escribiendo. Ninguna de sus rutas escribe una fila en `template`,
 * `template_item` ni `template_version`, salvo `POST drafts/:id/publish`, que convierte un
 * borrador válido en una nueva versión publicada de forma atómica.
 *
 * Las cinco rutas de borrador son del coordinador, el `GET` incluido. El servicio lo
 * comprueba, y ahí está la única defensa que hay: `template_draft` no lleva `site_id` y por
 * lo tanto no tiene política RLS detrás (migración 0016 §5).
 *
 * La lectura de una versión publicada no es autoría: como `GET /templates`, está disponible
 * para cualquier cuenta autenticada y se resuelve por el id congelado que pidió el cliente.
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  async list(@CurrentSession() session: SessionContext): Promise<TemplateOption[]> {
    return this.templates.list(session);
  }

  /**
   * El catálogo COMPLETO, retiradas incluidas. Es del coordinador, como los borradores.
   *
   * Ruta aparte y no un parámetro de `GET /templates` a propósito: aquel listado es lo que
   * se puede programar y lo consume `/scheduling`; este es lo que se administra. Una sola
   * ruta con una bandera dejaría que quien la llama decida cuál de las dos preguntas está
   * haciendo, y la de programar no admite otra respuesta.
   */
  @Get('published')
  async listPublished(
    @CurrentSession() session: SessionContext,
  ): Promise<PublishedTemplateSummary[]> {
    return this.templates.listPublished(session);
  }

  @Get('versions/:versionId')
  async getPublishedVersion(
    @CurrentSession() session: SessionContext,
    @Param('versionId') versionId: string,
  ): Promise<PublishedTemplateVersion> {
    return this.templates.getPublishedVersion(session, z.uuid().parse(versionId));
  }

  /**
   * Revisar una plantilla publicada: siembra un borrador con su última versión.
   *
   * `POST` y no `GET` porque escribe una fila, aunque no reciba cuerpo: la plantilla que se
   * revisa está en la ruta y no hay nada más que elegir. Es IDEMPOTENTE — si la plantilla ya
   * tiene una revisión viva, devuelve esa en vez de crear una segunda.
   *
   * Cuelga de `/templates/:templateId` y no de `/templates/drafts` porque el sujeto es la
   * plantilla publicada: el borrador es la consecuencia.
   */
  @Post(':templateId/revisions')
  async reviseTemplate(
    @CurrentSession() session: SessionContext,
    @Param('templateId') templateId: string,
  ): Promise<TemplateDraft> {
    return this.templates.reviseTemplate(session, z.uuid().parse(templateId));
  }

  /**
   * Retirar y volver a poner una plantilla en el catálogo.
   *
   * Dos rutas y no un `PATCH` con una bandera: son dos decisiones distintas —una saca del
   * catálogo, la otra devuelve— y el verbo de la ruta lo dice sin que haya que leer el
   * cuerpo. Es el mismo par que `POST /sites/:id/deactivate` y `/reactivate`.
   *
   * El cuerpo se valida contra un objeto ESTRICTO VACÍO: la fecha la pone el motor con
   * `now()`, y aceptar una del cliente sería aceptar una baja fechada en cualquier día.
   *
   * `204` y no la fila resultante: el estado que la pantalla necesita después es el listado
   * entero —también cambia lo que ofrece `/scheduling`—, así que devolver una fila suelta
   * invitaría a parchear la caché con la mitad de lo que cambió.
   */
  @Post(':templateId/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @CurrentSession() session: SessionContext,
    @Param('templateId') templateId: string,
    @Body() body: unknown,
  ): Promise<void> {
    deactivateTemplateSchema.parse(body ?? {});

    return this.templates.deactivate(session, z.uuid().parse(templateId));
  }

  @Post(':templateId/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivate(
    @CurrentSession() session: SessionContext,
    @Param('templateId') templateId: string,
    @Body() body: unknown,
  ): Promise<void> {
    reactivateTemplateSchema.parse(body ?? {});

    return this.templates.reactivate(session, z.uuid().parse(templateId));
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

  /** Publicar no recibe cuerpo: el borrador guardado ya contiene toda la fuente de verdad. */
  @Post('drafts/:id/publish')
  async publishDraft(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<PublishedTemplate> {
    return this.templates.publishDraft(session, id);
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
