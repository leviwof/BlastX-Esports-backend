import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('broadcast')
  broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.notifications.broadcast(dto);
  }
}
