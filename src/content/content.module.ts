import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { AdminBannersController } from './admin-banners.controller';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { AdminNoticesController } from './admin-notices.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    ContentController,
    AdminBannersController,
    AdminAnnouncementsController,
    AdminNoticesController,
  ],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
