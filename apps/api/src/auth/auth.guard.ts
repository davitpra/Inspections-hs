import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { sessionEnded } from './auth.errors';
import { SessionService, type SessionContext } from './session.service';

/** Rutas sin sesión: login, aceptación de invitación, y nada más. */
export const PUBLIC = 'auth:public';
export const Public = (): CustomDecorator => SetMetadata(PUBLIC, true);

export interface AuthenticatedRequest extends Request {
  session: SessionContext;
}

/**
 * ADR-011 — El guard. Resuelve el token en una sola consulta y deja la sesión en el
 * request; nadie más vuelve a tocar la base para saber quién está del otro lado.
 *
 * Lo que este guard NO hace, y es deliberado: no decide qué puede hacer cada rol con
 * cada recurso. El rol y el alcance quedan disponibles; qué habilita cada uno lo
 * deciden los changes que tengan endpoints de dominio.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request);

    if (!token) throw sessionEnded('No session token was presented');

    // `resolve` lanza `token_expired` cuando el access token venció y `session_ended`
    // en todo lo demás. La diferencia es el requisito offline (design D5): el cliente
    // que vacía el outbox necesita separar "refrescá y reintentá" de "pará".
    const session = await this.sessions.resolve(token);

    request.session = session;

    return true;
  }
}

function extractBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, value] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
