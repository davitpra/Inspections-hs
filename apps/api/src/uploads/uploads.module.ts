import { Module } from '@nestjs/common';

import { ObjectStorageService } from './object-storage';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * ADR-006 — La subida de fotos por presigned URL.
 *
 * Sin migración: este módulo no crea ni altera ninguna tabla. Lo único que produce es
 * una firma.
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, ObjectStorageService],
  exports: [UploadsService],
})
export class UploadsModule {}
