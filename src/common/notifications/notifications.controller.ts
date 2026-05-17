import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  async listMine(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationsService.listForUser({
      userId: user.userId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.markRead({
      userId: user.userId,
      notificationId: id,
    });
  }

  @Post('me/mark-all-read')
  async markAllRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllRead({ userId: user.userId });
  }

  @Delete('me')
  async clearAll(@CurrentUser() user: any) {
    return this.notificationsService.clearAll({ userId: user.userId });
  }
}
