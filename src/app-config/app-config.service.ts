import { Injectable } from '@nestjs/common'; import { AppConfig } from '@prisma/client'; import { PrismaService } from '../prisma/prisma.service'; import { RedisService } from '../redis/redis.service';
@Injectable()
export class AppConfigService {
  private readonly key = 'app_config:init';
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async getInit(): Promise<{ min_version: string; latest_version: string; is_maintenance: boolean; maintenance_message: string; update_url: string }> {
    let cached: string | null = null;
    try {
      cached = await this.redis.client.get(this.key);
    } catch {
      // Redis offline or failed - fallback directly to PostgreSQL DB
    }

    const config: AppConfig = cached
      ? (JSON.parse(cached) as AppConfig)
      : await this.prisma.appConfig.findUniqueOrThrow({ where: { id: 1 } });

    if (!cached) {
      try {
        await this.redis.client.set(this.key, JSON.stringify(config), 'EX', 60);
      } catch {
        // Ignore cache write failure
      }
    }

    return {
      min_version: config.minVersion,
      latest_version: config.latestVersion,
      is_maintenance: config.isMaintenance,
      maintenance_message: config.maintenanceMessage,
      update_url: config.updateUrl,
    };
  }
}
