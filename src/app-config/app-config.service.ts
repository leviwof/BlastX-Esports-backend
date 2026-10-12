import { Injectable } from '@nestjs/common';
import { AppConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UpdateConfigDto } from './dto/update-config.dto';

export interface RecordingConfig {
  video_bitrate_kbps: number;
  max_height: number;
  fps: number;
  max_duration_minutes: number;
  min_free_space_mb: number;
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  video_bitrate_kbps: 2500,
  max_height: 720,
  fps: 30,
  max_duration_minutes: 60,
  min_free_space_mb: 1500,
};

export interface AppConfigResponse {
  min_version: string;
  latest_version: string;
  is_maintenance: boolean;
  maintenance_message: string;
  update_url: string;
  recording: RecordingConfig;
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

    const rawRec = (config.recordingConfig as any) || {};
    const recording: RecordingConfig = {
      video_bitrate_kbps: Number(rawRec.video_bitrate_kbps ?? DEFAULT_RECORDING_CONFIG.video_bitrate_kbps),
      max_height: Number(rawRec.max_height ?? DEFAULT_RECORDING_CONFIG.max_height),
      fps: Number(rawRec.fps ?? DEFAULT_RECORDING_CONFIG.fps),
      max_duration_minutes: Number(rawRec.max_duration_minutes ?? DEFAULT_RECORDING_CONFIG.max_duration_minutes),
      min_free_space_mb: Number(rawRec.min_free_space_mb ?? DEFAULT_RECORDING_CONFIG.min_free_space_mb),
    };

    return {
      min_version: config.minVersion,
      latest_version: config.latestVersion,
      is_maintenance: config.isMaintenance,
      maintenance_message: config.maintenanceMessage,
      update_url: config.updateUrl,
      recording,
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

    const rawRec = (config.recordingConfig as any) || {};
    const recording: RecordingConfig = {
      video_bitrate_kbps: Number(rawRec.video_bitrate_kbps ?? DEFAULT_RECORDING_CONFIG.video_bitrate_kbps),
      max_height: Number(rawRec.max_height ?? DEFAULT_RECORDING_CONFIG.max_height),
      fps: Number(rawRec.fps ?? DEFAULT_RECORDING_CONFIG.fps),
      max_duration_minutes: Number(rawRec.max_duration_minutes ?? DEFAULT_RECORDING_CONFIG.max_duration_minutes),
      min_free_space_mb: Number(rawRec.min_free_space_mb ?? DEFAULT_RECORDING_CONFIG.min_free_space_mb),
    };

    return {
      min_version: config.minVersion,
      latest_version: config.latestVersion,
      is_maintenance: config.isMaintenance,
      maintenance_message: config.maintenanceMessage,
      update_url: config.updateUrl,
      recording,
    };
  }
}
