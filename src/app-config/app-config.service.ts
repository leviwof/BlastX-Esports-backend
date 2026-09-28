import { Injectable } from '@nestjs/common';
import { AppConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UpdateConfigDto } from './dto/update-config.dto';

export interface AppConfigResponse {
  min_version: string;
  latest_version: string;
  is_maintenance: boolean;
  maintenance_message: string;
  update_url: string;
}

@Injectable()
export class AppConfigService {
  private readonly key = 'app_config:init';
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async getInit(): Promise<AppConfigResponse> {
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

  async updateConfig(dto: UpdateConfigDto): Promise<AppConfigResponse> {
    const data: {
      minVersion?: string;
      latestVersion?: string;
      isMaintenance?: boolean;
      maintenanceMessage?: string;
      updateUrl?: string;
    } = {};

    if (dto.min_version !== undefined) data.minVersion = dto.min_version;
    if (dto.latest_version !== undefined) data.latestVersion = dto.latest_version;
    if (dto.is_maintenance !== undefined) data.isMaintenance = dto.is_maintenance;
    if (dto.maintenance_message !== undefined) data.maintenanceMessage = dto.maintenance_message;
    if (dto.update_url !== undefined) data.updateUrl = dto.update_url;

    const config = await this.prisma.appConfig.upsert({
      where: { id: 1 },
      update: data,
      create: {
        id: 1,
        minVersion: dto.min_version ?? '1.0.0',
        latestVersion: dto.latest_version ?? '1.0.0',
        isMaintenance: dto.is_maintenance ?? false,
        maintenanceMessage: dto.maintenance_message ?? '',
        updateUrl: dto.update_url ?? '',
      },
    });

    try {
      await this.redis.client.del(this.key);
    } catch {
      // Ignore cache invalidation failure
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
