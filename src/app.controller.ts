import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Railway probes this path directly (no global prefix).
  @Get('health')
  health(): { healthy: boolean; uptime: number } {
    return { healthy: true, uptime: process.uptime() };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
