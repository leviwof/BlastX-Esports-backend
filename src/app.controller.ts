import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { getBuildInfo } from './common/build-info';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Railway probes this path directly (no global prefix).
  @Get('health')
  health(): { healthy: boolean; uptime: number; commit: string } {
    return {
      healthy: true,
      uptime: process.uptime(),
      commit: getBuildInfo().commit,
    };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
