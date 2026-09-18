import { Controller, Get } from '@nestjs/common'; import { AppConfigService } from './app-config.service';
@Controller('config') export class AppConfigController { constructor(private readonly service: AppConfigService) {} @Get('init') init() { return this.service.getInit(); } }
