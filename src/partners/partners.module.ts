import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { AdminPartnerInquiriesController } from './admin-partner-inquiries.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PartnersController, AdminPartnerInquiriesController],
  providers: [PartnersService],
})
export class PartnersModule {}
