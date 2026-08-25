import { basename } from 'node:path';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { rosterQuerySchema, type PersonWithAccount, type RosterImportReport } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { rosterFileUnusable } from './roster.errors';
import { RosterService } from './roster.service';
import { ROSTER_FILE_LIMIT, RosterUploadExceptionFilter } from './roster-upload.filter';

/**
 * La superficie HTTP del roster: lectura e importación de archivo completo.
 *
 * `/people` y no `/roster`: el recurso son las personas; "roster" es la pantalla.
 *
 * **Esto no es el selector de sujeto.** Aquel vive en `GET /scheduled-inspections/:id/roster`,
 * devuelve cuatro columnas y lo puede llamar cualquiera; §4 dice que el supervisor elige a
 * una persona *sin poder ver su perfil*, y esa frase ata a esa ruta, no a esta. Acá el rol se
 * comprueba en la lectura porque esta ruta SÍ devuelve el perfil. Conectar el selector de
 * incidentes a `/people` rompería lo único que las mantiene separadas.
 *
 * No hay escritura por persona: crear, renombrar, transferir y desactivar se hace solo al
 * aplicar el archivo entero, por HTTP o con `pnpm roster:import`.
 */
@Controller()
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  /** El roster de una planta. `site_id` es selección entre el alcance, no el límite. */
  @Get('people')
  async list(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<PersonWithAccount[]> {
    return this.roster.list(session, rosterQuerySchema.parse(query));
  }

  @Post('people/import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ROSTER_FILE_LIMIT, files: 1 } }))
  @UseFilters(RosterUploadExceptionFilter)
  async import(
    @CurrentSession() session: SessionContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RosterImportReport> {
    if (!file) throw rosterFileUnusable('submit exactly one file field named "file"');

    const sourceFilename = basename(file.originalname).trim();
    if (!sourceFilename) throw rosterFileUnusable('the file name is empty');

    return this.roster.import(session, {
      text: file.buffer.toString('utf8'),
      sourceFilename,
    });
  }
}
