import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import {
  SaveDeviceTokenDto,
  DeleteDeviceTokenDto,
  NotificationQueryDto,
} from './dto/device-token.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Device token registration/update.
   * Path: POST /v1/users/me/device-token
   */
  @Post('users/me/device-token')
  @HttpCode(HttpStatus.OK)
  saveDeviceToken(
    @CurrentUser() user: JwtUser,
    @Body() dto: SaveDeviceTokenDto,
  ): Promise<{ ok: boolean }> {
    return this.notifications.saveDeviceToken(user.sub, dto.token, dto.platform);
  }

  /**
   * Device token deletion on logout.
   * Path: DELETE /v1/users/me/device-token
   */
  @Delete('users/me/device-token')
  @HttpCode(HttpStatus.OK)
  deleteDeviceToken(
    @CurrentUser() user: JwtUser,
    @Body() dto: DeleteDeviceTokenDto,
  ): Promise<{ ok: boolean }> {
    return this.notifications.deleteDeviceToken(user.sub, dto.token);
  }

  /**
   * Legacy route for mobile app backward compatibility.
   * Path: POST /v1/user/fcm-token
   */
  @Post('user/fcm-token')
  @HttpCode(HttpStatus.OK)
  registerFcmToken(
    @CurrentUser() user: JwtUser,
    @Body() dto: RegisterFcmTokenDto,
  ): Promise<{ status: true; message: string }> {
    return this.notifications.registerFcmToken(user.sub, dto.fcm_token, dto.device_type);
  }

  /**
   * Get user's in-app notifications with pagination & unread count.
   * Path: GET /v1/users/me/notifications
   */
  @Get('users/me/notifications')
  getMyNotifications(
    @CurrentUser() user: JwtUser,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notifications.getUserNotifications(user.sub, query.page, query.limit);
  }

  /**
   * Mark all notifications as read.
   * Path: PATCH /v1/users/me/notifications/read-all
   */
  @Patch('users/me/notifications/read-all')
  markAllNotificationsRead(@CurrentUser() user: JwtUser) {
    return this.notifications.markAllAsRead(user.sub);
  }

  /**
   * Mark a single notification as read.
   * Path: PATCH /v1/users/me/notifications/:id/read
   */
  @Patch('users/me/notifications/:id/read')
  markNotificationRead(
    @CurrentUser() user: JwtUser,
    @Param('id') notificationId: string,
  ) {
    return this.notifications.markAsRead(user.sub, notificationId);
  }
}
