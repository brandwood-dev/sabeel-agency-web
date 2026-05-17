import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private client: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);
  private isRedisAvailable = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      this.client = new Redis({
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD'),
        db: this.configService.get<number>('REDIS_DB', 0),
        connectTimeout: 5000,
        maxRetriesPerRequest: 3,
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis connection error:', err.message);
        this.isRedisAvailable = false;
      });

      this.client.on('connect', () => {
        this.logger.log('Connected to Redis');
        this.isRedisAvailable = true;
      });

      // Test connection with timeout
      await Promise.race([
        this.client.ping(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 3000)
        )
      ]);
      
      this.isRedisAvailable = true;
      this.logger.log('Redis connection successful');
    } catch (error) {
      this.logger.warn('Redis not available, using in-memory fallback:', error.message);
      this.isRedisAvailable = false;
      this.client = null;
    }
  }

  private memoryCache = new Map<string, { value: any; expiry: number }>();

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (this.isRedisAvailable && this.client) {
      try {
        const serializedValue = JSON.stringify(value);
        if (ttl) {
          await this.client.setex(key, ttl, serializedValue);
        } else {
          await this.client.set(key, serializedValue);
        }
      } catch (error) {
        this.logger.warn('Redis set failed, using memory fallback:', error.message);
        this.setMemory(key, value, ttl);
      }
    } else {
      this.setMemory(key, value, ttl);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.isRedisAvailable && this.client) {
      try {
        const value = await this.client.get(key);
        if (value === null) {
          return null;
        }
        return JSON.parse(value);
      } catch (error) {
        this.logger.warn('Redis get failed, using memory fallback:', error.message);
        return this.getMemory<T>(key);
      }
    } else {
      return this.getMemory<T>(key);
    }
  }

  async del(key: string): Promise<void> {
    if (this.isRedisAvailable && this.client) {
      try {
        await this.client.del(key);
      } catch (error) {
        this.logger.warn('Redis del failed, using memory fallback:', error.message);
        this.memoryCache.delete(key);
      }
    } else {
      this.memoryCache.delete(key);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.isRedisAvailable && this.client) {
      try {
        const result = await this.client.exists(key);
        return result === 1;
      } catch (error) {
        this.logger.warn('Redis exists failed, using memory fallback:', error.message);
        return this.memoryCache.has(key);
      }
    } else {
      return this.memoryCache.has(key);
    }
  }

  async setWithExpiry(key: string, value: any, ttlSeconds: number): Promise<void> {
    await this.set(key, value, ttlSeconds);
  }

  getClient(): Redis | null {
    return this.client;
  }

  isRedisConnected(): boolean {
    return this.isRedisAvailable;
  }

  private setMemory(key: string, value: any, ttl?: number): void {
    const expiry = ttl ? Date.now() + ttl * 1000 : 0;
    this.memoryCache.set(key, { value, expiry });
  }

  private getMemory<T>(key: string): T | null {
    const item = this.memoryCache.get(key);
    if (!item) {
      return null;
    }

    if (item.expiry > 0 && Date.now() > item.expiry) {
      this.memoryCache.delete(key);
      return null;
    }

    return item.value;
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        this.logger.error('Error closing Redis connection:', error);
      }
    }
  }
}
