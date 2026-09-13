import { basename } from 'node:path';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createPersonRequestSchema,
  deactivatePersonRequestSchema,
  rosterQuerySchema,
  type Person,
  type PersonWithAccount,
  type RosterImportReport,
  updatePersonRequestSchema,
} from '@hs/contracts';

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
 * devuelve cuatro columnas y lo puede llamar cualquiera; §4 dice que quien reporta elige a
 * una persona *sin poder ver su perfil*, y esa frase ata a esa ruta, no a esta. Acá el rol se
 * comprueba en la lectura porque esta ruta SÍ devuelve el perfil. Conectar el selector de
 * incidentes a `/people` rompería lo único que las mantiene separadas.
 *
 * Las escrituras por persona son el alta, la baja estrecha de un worker sin cuenta y la
 * corrección de una persona activa. Transferir y reactivar siguen sin ruta.
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

  /** El alta de UNA persona (`add-person-to-roster-by-hand`). El CSV sigue siendo lo único que corrige. */
  @Post('people')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<Person> {
    return this.roster.create(session, createPersonRequestSchema.parse(body));
  }

  @Patch('people/:personId')
  async update(
    @CurrentSession() session: SessionContext,
    @Param('personId', new ParseUUIDPipe()) personId: string,
    @Body() body: unknown,
  ): Promise<Person> {
    if (deactivatePersonRequestSchema.safeParse(body).success) {
      return this.roster.deactivate(session, personId);
    }

    return this.roster.update(session, personId, updatePersonRequestSchema.parse(body));
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
