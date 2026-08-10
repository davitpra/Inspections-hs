import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  presignActionUploadRequestSchema,
  presignFindingUploadRequestSchema,
  presignUploadRequestSchema,
  type PresignUploadResponse,
} from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { UploadsService } from './uploads.service';

/**
 * La única ruta del módulo. Una URL firmada por foto, pedida justo antes del PUT
 * (design D7): firmarlas por lote al reconectar hace que la última expire mientras
 * sube la primera.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * `200` y no `201`: no se creó nada. El objeto existe cuando el dispositivo termina
   * el PUT contra el bucket, y de eso este servidor no se entera.
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  async presign(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<PresignUploadResponse> {
    return this.uploads.presign(session, presignUploadRequestSchema.parse(body));
  }

  /**
   * La misma operación para la foto de un hallazgo de entrada manual, que no tiene
   * inspección programada de la que colgar (etapa 4, design D9).
   *
   * Una ruta aparte y no un campo opcional en la de arriba: los dos pedidos se
   * autorizan distinto —uno contra una inspección activa, el otro contra el catálogo de
   * la planta— y un cuerpo con dos formas posibles habría dejado esa diferencia adentro
   * de un `if`.
   */
  @Post('presign/finding')
  @HttpCode(HttpStatus.OK)
  async presignFinding(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<PresignUploadResponse> {
    return this.uploads.presignFinding(session, presignFindingUploadRequestSchema.parse(body));
  }

  /**
   * La misma operación para la evidencia de una acción correctiva (etapa 5, design D9).
   *
   * Tercera ruta y no un campo más, por lo mismo que la segunda: los tres pedidos se
   * autorizan contra tres cosas distintas —una inspección activa, el catálogo de la
   * planta, una acción del alcance— y un cuerpo con tres formas posibles habría dejado
   * esa diferencia adentro de un `if`.
   */
  @Post('presign/action')
  @HttpCode(HttpStatus.OK)
  async presignAction(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<PresignUploadResponse> {
    return this.uploads.presignAction(session, presignActionUploadRequestSchema.parse(body));
  }
}
