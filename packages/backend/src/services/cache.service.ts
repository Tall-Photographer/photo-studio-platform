// packages/backend/src/services/cache.service.ts
import Redis from 'ioredis';
import { LoggerService } from './logger.service';

export class CacheService {
  private static instance: CacheService;
  private redis: Redis;
  private logger = LoggerService.getInstance();
  private isConnected = false;

  private constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    };

    this.redis = new Redis(redisConfig);
    this.setupEventHandlers();
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.isConnected = true;
      this.logger.info('Redis connected successfully');
    });

    this.redis.on('ready', () => {
      this.logger.info('Redis ready to receive commands');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
      this.isConnected = false;
    });

    this.redis.on('close', () => {
      this.logger.info('Redis connection closed');
      this.isConnected = false;
    });

    this.redis.on('reconnecting', () => {
      this.logger.info('Redis reconnecting...');
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.redis.connect();
      this.logger.info('Cache service connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to cache service:', error);
      // Don't throw error to allow app to run without Redis
      this.logger.warn('Running without cache service');
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.logger.info('Cache service disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from cache service:', error);
    }
  }

  public isReady(): boolean {
    return this.isConnected && this.redis.status === 'ready';
  }

  // Basic cache operations
  public async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.isReady()) {
      this.logger.warn('Cache not available, skipping set operation');
      return;
    }

    try {
      const serializedValue = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      this.logger.error('Cache set error:', error);
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    if (!this.isReady()) {
      this.logger.warn('Cache not available, skipping get operation');
      return null;
    }

    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error('Cache get error:', error);
      return null;
    }
  }

  public async del(key: string): Promise<void> {
    if (!this.isReady()) {
      this.logger.warn('Cache not available, skipping delete operation');
      return;
    }

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error('Cache delete error:', error);
    }
  }

  public async exists(key: string): Promise<boolean> {
    if (!this.isReady()) {
      return false;
    }

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Cache exists error:', error);
      return false;
    }
  }

  // User session management
  public async setUserSession(userId: string, sessionData: any, ttl: number = 3600): Promise<void> {
    const key = `session:${userId}`;
    await this.set(key, sessionData, ttl);
  }

  public async getUserSession(userId: string): Promise<any> {
    const key = `session:${userId}`;
    return this.get(key);
  }

  public async deleteUserSession(userId: string): Promise<void> {
    const key = `session:${userId}`;
    await this.del(key);
  }

  // Rate limiting
  public async incrementRateLimit(key: string, windowMs: number): Promise<number> {
    if (!this.isReady()) {
      return 0;
    }

    try {
      const multi = this.redis.multi();
      multi.incr(key);
      multi.expire(key, Math.ceil(windowMs / 1000));
      const results = await multi.exec();
      return results?.[0]?.[1] as number || 0;
    } catch (error) {
      this.logger.error('Rate limit increment error:', error);
      return 0;
    }
  }

  // Studio-specific caching
  public async cacheStudioData(studioId: string, data: any, ttl: number = 300): Promise<void> {
    const key = `studio:${studioId}`;
    await this.set(key, data, ttl);
  }

  public async getStudioData(studioId: string): Promise<any> {
    const key = `studio:${studioId}`;
    return this.get(key);
  }

  public async invalidateStudioCache(studioId: string): Promise<void> {
    const pattern = `studio:${studioId}*`;
    if (!this.isReady()) return;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error('Cache invalidation error:', error);
    }
  }

  // Dashboard statistics caching
  public async cacheDashboardStats(studioId: string, stats: any): Promise<void> {
    const key = `dashboard:${studioId}`;
    await this.set(key, stats, 300); // 5 minutes TTL
  }

  public async getDashboardStats(studioId: string): Promise<any> {
    const key = `dashboard:${studioId}`;
    return this.get(key);
  }

  // Email verification tokens
  public async setEmailVerificationToken(email: string, token: string): Promise<void> {
    const key = `email_verification:${email}`;
    await this.set(key, token, 86400); // 24 hours
  }

  public async getEmailVerificationToken(email: string): Promise<string | null> {
    const key = `email_verification:${email}`;
    return this.get(key);
  }

  public async deleteEmailVerificationToken(email: string): Promise<void> {
    const key = `email_verification:${email}`;
    await this.del(key);
  }

  // Password reset tokens
  public async setPasswordResetToken(email: string, token: string): Promise<void> {
    const key = `password_reset:${email}`;
    await this.set(key, token, 3600); // 1 hour
  }

  public async getPasswordResetToken(email: string): Promise<string | null> {
    const key = `password_reset:${email}`;
    return this.get(key);
  }

  public async deletePasswordResetToken(email: string): Promise<void> {
    const key = `password_reset:${email}`;
    await this.del(key);
  }

  public getClient(): Redis {
    return this.redis;
  }
}