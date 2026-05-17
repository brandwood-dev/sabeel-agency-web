import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DOMAIN_SIDE_EFFECTS_DLQ_QUEUE, DOMAIN_SIDE_EFFECTS_QUEUE } from './queue.constants';

@Injectable()
export class QueueProvider implements OnModuleDestroy {
  private readonly logger = new Logger(QueueProvider.name);

  private readonly connection: IORedis | null;
  readonly domainSideEffectsQueue: Queue | null;
  readonly domainSideEffectsDlqQueue: Queue | null;

  constructor(private readonly configService: ConfigService) {
    // Try to connect to Redis; if unavailable, queues become no-ops
    try {
      this.connection = new IORedis({
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
        db: this.configService.get<number>('REDIS_DB', 0),
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        lazyConnect: true, // defer connection until first use
      });

      this.connection.on('error', (err) => {
        this.logger.warn('Redis connection failed (queues disabled): ' + (err?.message || err));
      });

      this.domainSideEffectsQueue = new Queue(DOMAIN_SIDE_EFFECTS_QUEUE, {
        connection: this.connection,
      });

      this.domainSideEffectsDlqQueue = new Queue(DOMAIN_SIDE_EFFECTS_DLQ_QUEUE, {
        connection: this.connection,
      });
    } catch (err) {
      this.logger.error('Failed to initialize Redis (queues disabled): ' + (err?.message || err));
      // Fallback: set to null so methods can safely no-op
      this.connection = null as any;
      this.domainSideEffectsQueue = null as any;
      this.domainSideEffectsDlqQueue = null as any;
    }
  }

  getConnection() {
    return this.connection;
  }

  async onModuleDestroy() {
    try {
      if (this.domainSideEffectsQueue) await this.domainSideEffectsQueue.close();
    } catch {
      // ignore
    }

    try {
      if (this.domainSideEffectsDlqQueue) await this.domainSideEffectsDlqQueue.close();
    } catch {
      // ignore
    }

    try {
      if (this.connection) await this.connection.quit();
    } catch {
      // ignore
    }
  }
}
