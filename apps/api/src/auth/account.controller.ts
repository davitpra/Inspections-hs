import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  createAccountRequestSchema,
  updateAccountRequestSchema,
  type AccountDetail,
  type CreateAccountResponse,
} from '@hs/contracts';

import { CurrentSession } from './session.decorator';
import type { SessionContext } from './session.service';
import { AccountService } from './account.service';

/**
 * `POST /accounts` — proposal: el único eslabón del alta que todavía exigía una
   * terminal. Solo las cuentas administrativas; el rol se comprueba en `AccountService.create`.
 *
 * No crea personas ni credenciales: crea `app_user` y su `user_site_scope`, y —cuando
 * se pide— la invitación en el mismo acto (design D4).
 *
 * `GET`/`PATCH /accounts/:id` — `reissue-invitation-link-from-roster`, design D5/D6: leer
 * el detalle de UNA cuenta (con su email, que el roster nunca devuelve) y reemitir su link
 * corrigiendo ese email en el mismo acto. El rol se comprueba en `AccountService`, igual
 * que en `create`.
 */
@Controller('accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<CreateAccountResponse> {
    return this.accounts.create(session, createAccountRequestSchema.parse(body));
  }

  @Get(':id')
  async find(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<AccountDetail> {
    return this.accounts.find(session, id);
  }

  @Patch(':id')
  async update(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CreateAccountResponse> {
    return this.accounts.update(session, id, updateAccountRequestSchema.parse(body));
  }
}
