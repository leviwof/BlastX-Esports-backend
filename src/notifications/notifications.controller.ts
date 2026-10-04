import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('fcm-token')
  registerFcmToken(
    @CurrentUser() user: JwtUser,
    @Body() dto: RegisterFcmTokenDto,
  ): Promise<{ status: true; message: string }> {
    return this.notifications.registerFcmToken(user.sub, dto.fcm_token, dto.device_type);
  }
}
