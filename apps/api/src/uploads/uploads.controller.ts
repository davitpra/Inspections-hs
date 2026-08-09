import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { presignUploadRequestSchema, type PresignUploadResponse } from '@hs/contracts';

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
}
