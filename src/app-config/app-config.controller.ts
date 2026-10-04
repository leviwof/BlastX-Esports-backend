import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { AppConfigService } from './app-config.service';

@Controller('config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  @Public()
  @Get('init')
  init() {
    return this.service.getInit();
  }
}
