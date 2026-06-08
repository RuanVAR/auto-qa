import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { clampLimit } from '../../common/util/pagination';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  /** GET /api/v1/notifications — list for current user */
  @Get()
  list(
    @Request() req: { user: { sub: string; activeOrgId: string } },
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.findForUser(req.user.sub, req.user.activeOrgId, {
      unreadOnly: unreadOnly === 'true',
      page: page ? parseInt(page, 10) : 1,
      limit: clampLimit(limit, { def: 20, max: 200 }),
    });
  }

  /** GET /api/v1/notifications/unread-count */
  @Get('unread-count')
  unreadCount(@Request() req: { user: { sub: string; activeOrgId: string } }) {
    return this.svc
      .countUnread(req.user.sub, req.user.activeOrgId)
      .then(count => ({ count }));
  }

  /** PATCH /api/v1/notifications/mark-all-read */
  @Patch('mark-all-read')
  markAllRead(@Request() req: { user: { sub: string; activeOrgId: string } }) {
    return this.svc.markAllRead(req.user.sub, req.user.activeOrgId);
  }

  /** PATCH /api/v1/notifications/:id/read */
  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.svc.markRead(id, req.user.sub);
  }
}
