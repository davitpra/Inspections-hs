import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  acceptInvitationRequestSchema,
  confirmTwoFactorRequestSchema,
  issueInvitationRequestSchema,
  refreshRequestSchema,
  resetTwoFactorRequestSchema,
  revokeInvitationRequestSchema,
  revokeSessionsRequestSchema,
  signInRequestSchema,
  type EnrolTwoFactorResponse,
  type IssueInvitationResponse,
  type RefreshResponse,
  type Session,
  type SignInResponse,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import { AuthService } from './auth.service';
import { AllowsEnrolmentSession, Public } from './auth.guard';
import { forbidden, twoFactorRequired } from './auth.errors';
import { CredentialService } from './credential.service';
import { CurrentSession } from './session.decorator';
import { InvitationService } from './invitation.service';
import { SessionService, type SessionContext } from './session.service';
import { TwoFactorService } from './two-factor.service';

/**
 * ADR-011 — La única superficie de autenticación del sistema.
 *
 * El router de better-auth NO se monta (design D16): sus rutas desconocen el bloqueo
 * por intentos, el segundo factor obligatorio por rol, el `purpose` de la sesión, el
 * refresh y la cadena de auditoría. Montarlas al lado de estas sería dejar abierta
 * una puerta al mismo cuarto sin ninguna de las cerraduras.
 *
 * NINGUNA de estas rutas acepta un sitio, un alcance o un actor como parámetro: el
 * alcance sale de la sesión y de ningún otro lado.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly invitations: InvitationService,
    private readonly twoFactor: TwoFactorService,
    private readonly credentials: CredentialService,
    private readonly db: DbService,
  ) {}

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() body: unknown, @Req() request: Request): Promise<SignInResponse> {
    const parsed = signInRequestSchema.parse(body);

    return this.auth.signIn(parsed, {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  /**
   * El refresh es público porque su credencial ES el refresh token: exigir un access
   * token válido para renovarlo sería exigir lo que se viene a renovar.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown): Promise<RefreshResponse> {
    const { refreshToken } = refreshRequestSchema.parse(body);
    const { tokens } = await this.sessions.refresh(refreshToken);

    return { tokens };
  }

  /** Acepta la sesión limitada: cerrar sesión es lo que siempre se puede hacer. */
  @AllowsEnrolmentSession()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentSession() session: SessionContext): Promise<void> {
    await this.auth.signOut(session.sessionId);
  }

  /**
   * Quién está adentro. Devuelve la sesión resuelta —`userId`, `personId`, `role`,
   * `siteScope`— y nada más: ningún hash, ningún secreto, ningún token.
   */
  @AllowsEnrolmentSession()
  @Get('session')
  session(@CurrentSession() session: SessionContext): Session {
    return this.sessions.toContractSession(session);
  }

  // -------------------------------------------------------------------------
  // Invitación

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  async issueInvitation(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<IssueInvitationResponse> {
    const { userId, expiresInHours } = issueInvitationRequestSchema.parse(body);

    return this.invitations.issue(session, userId, expiresInHours);
  }

  @Post('invitations/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<void> {
    const { invitationId } = revokeInvitationRequestSchema.parse(body);

    await this.invitations.revoke(session, invitationId);
  }

  /**
   * Sin sesión: quien acepta todavía no tiene forma de tener una. Su credencial es el
   * token de la invitación.
   */
  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptInvitation(@Body() body: unknown): Promise<void> {
    const { token, password } = acceptInvitationRequestSchema.parse(body);

    await this.invitations.accept(token, password);
  }

  // -------------------------------------------------------------------------
  // Segundo factor — las dos únicas rutas de la lista blanca de design D7

  @AllowsEnrolmentSession()
  @Post('two-factor/enrol')
  @HttpCode(HttpStatus.OK)
  async enrolTwoFactor(
    @CurrentSession() session: SessionContext,
  ): Promise<EnrolTwoFactorResponse> {
    const { rows } = await this.db.unscopedPool.query<{ email: string }>(
      `SELECT email FROM app_user WHERE id = $1`,
      [session.userId],
    );

    return this.twoFactor.enrol(session.userId, rows[0]?.email ?? session.userId);
  }

  /**
   * Confirmar NO convierte la sesión limitada en plena: la revoca y obliga a un login
   * nuevo con código. Ese login es el primer uso real del segundo factor y por lo
   * tanto la prueba de que quedó bien inscrito — sin él, un secreto mal cargado se
   * descubriría recién al día siguiente.
   */
  @AllowsEnrolmentSession()
  @Post('two-factor/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmTwoFactor(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<void> {
    const { code } = confirmTwoFactorRequestSchema.parse(body);

    if (!(await this.twoFactor.confirm(session.userId, code))) {
      throw twoFactorRequired();
    }

    await this.sessions.revokeSession(session.sessionId, 'two_factor_enrolled');
  }

  /**
   * El reinicio lo hace el coordinador, nunca el titular. Revocarle el segundo factor
   * a alguien le corta las sesiones vivas: la cuenta vuelve al estado en que tiene que
   * inscribir antes de volver a servir.
   */
  @Post('two-factor/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetTwoFactor(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<void> {
    const { userId } = resetTwoFactorRequestSchema.parse(body);

    await this.twoFactor.reset(userId, session);
    await this.sessions.revokeAllForUser(userId, 'two_factor_reset');
  }

  // -------------------------------------------------------------------------
  // Revocación

  @Post('sessions/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSessions(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<void> {
    const { userId } = revokeSessionsRequestSchema.parse(body);

    if (session.role !== 'hs_coordinator') {
      throw forbidden("Only the HS coordinator can end another account's sessions");
    }

    await this.sessions.revokeAllForUser(userId, 'revoked_by_coordinator');
  }

  /**
   * Revocar la credencial de una cuenta. Es la primera mitad del reinicio de
   * contraseña de design D9; la segunda es emitir una invitación nueva.
   */
  @Post('credentials/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeCredential(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<void> {
    const { userId } = revokeSessionsRequestSchema.parse(body);

    if (session.role !== 'hs_coordinator') {
      throw forbidden('Only the HS coordinator can revoke a credential');
    }

    await this.credentials.revoke(userId, session.userId);
    await this.sessions.revokeAllForUser(userId, 'credential_revoked');
  }
}
