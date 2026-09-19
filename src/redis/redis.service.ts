import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { healthStatus } from '../common/health-status';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private lastLoggedErrorTime = 0;

  constructor(config: ConfigService) {
    console.log('[DIAG] RedisService constructor START');
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        return Math.min(times * 2000, 10000);
      },
    });
    console.log('[DIAG] RedisService constructor DONE (ioredis client created)');

    this.client.on('ready', () => {
      healthStatus.redis = true;
      this.logger.log('Redis connection ready');
    });

    this.client.on('end', () => {
      healthStatus.redis = false;
    });

    this.client.on('error', (err) => {
      healthStatus.redis = false;
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
