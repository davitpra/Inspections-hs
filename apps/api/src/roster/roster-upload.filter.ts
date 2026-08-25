import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

import { rosterFileTooLarge, rosterFileUnusable } from './roster.errors';

export const ROSTER_FILE_LIMIT = 2 * 1024 * 1024;

/** Traduce localmente los errores esperados que `FileInterceptor` recibe de Multer. */
@Catch(BadRequestException, PayloadTooLargeException)
export class RosterUploadExceptionFilter
  implements ExceptionFilter<BadRequestException | PayloadTooLargeException>
{
  catch(exception: BadRequestException | PayloadTooLargeException, host: ArgumentsHost): void {
    const normalized =
      exception instanceof PayloadTooLargeException
        ? rosterFileTooLarge()
        : rosterFileUnusable('submit exactly one file field named "file"');
    const response = host.switchToHttp().getResponse<Response>();
    response.status(normalized.getStatus()).json(normalized.getResponse());
  }
}
