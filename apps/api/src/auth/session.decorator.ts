import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './auth.guard';
import type { SessionContext } from './session.service';

/**
 * La sesión resuelta por el guard. Es la ÚNICA vía por la que un endpoint conoce al
 * actor y su alcance: no hay parámetro, header ni campo del cuerpo que los pueda
 * declarar, y esa ausencia es el requisito, no una comodidad.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionContext =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().session,
);
