import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private lastLoggedErrorTime = 0;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        return Math.min(times * 2000, 10000);
      },
    });

    this.client.on('error', (err) => {
      const now = Date.now();
      // Log warning at most once per 60 seconds to prevent console spam when local Redis is offline
      if (now - this.lastLoggedErrorTime > 60000) {
        this.logger.warn(`Redis is offline or unreachable (${err.message}). App operating with DB fallback.`);
        this.lastLoggedErrorTime = now;
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
