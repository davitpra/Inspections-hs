import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DbService } from '../db/db.service';
import { AUTH_INSTANCE, createBetterAuth, type AuthInstance } from './better-auth';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CredentialService } from './credential.service';
import { InvitationService } from './invitation.service';
import { SessionService } from './session.service';

/**
 * ADR-011 — La autenticación, montada dentro de `apps/api` sobre la misma Postgres.
 *
 * El guard va como `APP_GUARD`: global, y las excepciones se declaran con `@Public()`
 * en la ruta que las necesita. Al revés —guard por controlador— una ruta nueva nace
 * abierta, y el día que alguien agregue un endpoint de hallazgos sin acordarse del
 * decorador, el sistema no se lo dice.
 */
@Module({
  controllers: [AuthController, AccountController],
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [DbService, SessionService],
      useFactory: (db: DbService, sessions: SessionService): AuthInstance =>
        createBetterAuth({
          pool: db.unscopedPool,
          secret: requireSecret(),
          baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
          // Design D15: lo que se hace en vez de borrar la fila.
          onSessionDelete: (sessionId) => sessions.revokeByLibraryDelete(sessionId),
        }),
    },
    SessionService,
    CredentialService,
    InvitationService,
    AccountService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService, CredentialService, InvitationService, AccountService],
})
export class AuthModule {}

/**
 * Sin secreto no se arranca. Un default de desarrollo acá sería un default de
 * producción el día que alguien despliegue sin leer el `.env.example`, y firma los
 * tokens de un sistema cuyo registro puede terminar ante el MLITSD.
 */
function requireSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET no está definida o es más corta que 32 caracteres. Ver .env.example.',
    );
  }

  return secret;
}
