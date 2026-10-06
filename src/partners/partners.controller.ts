import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { CreatePartnerInquiryDto } from './dto/create-partner-inquiry.dto';
import { PartnersService } from './partners.service';

@Controller('partners')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Public()
  @Post('inquire')
  submitInquiry(
    @Body() dto: CreatePartnerInquiryDto,
  ): Promise<{ success: true; status: 'success'; message: string }> {
    return this.partnersService.createInquiry(dto);
  }
}
