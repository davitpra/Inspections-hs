import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { Notification } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { NotificationsService } from './notifications.service';

/** La bandeja. Solo las propias: el `user_id` sale de la sesión y de ningún otro lado. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async inbox(@CurrentSession() session: SessionContext): Promise<Notification[]> {
    return this.notifications.inbox(session);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentSession() session: SessionContext,
    @Param('id') id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(session, id);
  }
}
