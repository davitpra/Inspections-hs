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
  // `ObjectStorageService` se exporta desde la etapa 7: el reporte de cumplimiento sube
  // su PDF y firma su descarga por el mismo cliente, con la misma credencial —la que no
  // lleva `DeleteObject`—. Un segundo cliente sería una segunda credencial que alguien
  // tendría que acordarse de dejar igual de recortada.
  exports: [UploadsService, ObjectStorageService],
})
export class UploadsModule {}
