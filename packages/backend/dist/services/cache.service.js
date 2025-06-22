"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_service_1 = require("./logger.service");
class CacheService {
  constructor() {
    this.logger = logger_service_1.LoggerService.getInstance();
    this.isConnected = false;
    const redisConfig = {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || "0", 10),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    };
    this.redis = new ioredis_1.default(redisConfig);
    this.setupEventHandlers();
  }
  static getInstance() {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }
  setupEventHandlers() {
    this.redis.on("connect", () => {
      this.isConnected = true;
      this.logger.info("Redis connected successfully");
    });
    this.redis.on("ready", () => {
      this.logger.info("Redis ready to receive commands");
    });
    this.redis.on("error", (error) => {
      this.logger.error("Redis connection error:", error);
      this.isConnected = false;
    });
    this.redis.on("close", () => {
      this.logger.info("Redis connection closed");
      this.isConnected = false;
    });
    this.redis.on("reconnecting", () => {
      this.logger.info("Redis reconnecting...");
    });
  }
  async connect() {
    try {
      await this.redis.connect();
      this.logger.info("Cache service connected successfully");
    } catch (error) {
      this.logger.error("Failed to connect to cache service:", error);
      this.logger.warn("Running without cache service");
    }
  }
  async disconnect() {
    try {
      await this.redis.disconnect();
      this.logger.info("Cache service disconnected successfully");
    } catch (error) {
      this.logger.error("Failed to disconnect from cache service:", error);
    }
  }
  isReady() {
    return this.isConnected && this.redis.status === "ready";
  }
  async set(key, value, ttl) {
    if (!this.isReady()) {
      this.logger.warn("Cache not available, skipping set operation");
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
      this.logger.error("Cache set error:", error);
    }
  }
  async get(key) {
    if (!this.isReady()) {
      this.logger.warn("Cache not available, skipping get operation");
      return null;
    }
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error("Cache get error:", error);
      return null;
    }
  }
  async del(key) {
    if (!this.isReady()) {
      this.logger.warn("Cache not available, skipping delete operation");
      return;
    }
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error("Cache delete error:", error);
    }
  }
  async exists(key) {
    if (!this.isReady()) {
      return false;
    }
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error("Cache exists error:", error);
      return false;
    }
  }
  async setUserSession(userId, sessionData, ttl = 3600) {
    const key = `session:${userId}`;
    await this.set(key, sessionData, ttl);
  }
  async getUserSession(userId) {
    const key = `session:${userId}`;
    return this.get(key);
  }
  async deleteUserSession(userId) {
    const key = `session:${userId}`;
    await this.del(key);
  }
  async incrementRateLimit(key, windowMs) {
    if (!this.isReady()) {
      return 0;
    }
    try {
      const multi = this.redis.multi();
      multi.incr(key);
      multi.expire(key, Math.ceil(windowMs / 1000));
      const results = await multi.exec();
      return results?.[0]?.[1] || 0;
    } catch (error) {
      this.logger.error("Rate limit increment error:", error);
      return 0;
    }
  }
  async cacheStudioData(studioId, data, ttl = 300) {
    const key = `studio:${studioId}`;
    await this.set(key, data, ttl);
  }
  async getStudioData(studioId) {
    const key = `studio:${studioId}`;
    return this.get(key);
  }
  async invalidateStudioCache(studioId) {
    const pattern = `studio:${studioId}*`;
    if (!this.isReady()) return;
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error("Cache invalidation error:", error);
    }
  }
  async cacheDashboardStats(studioId, stats) {
    const key = `dashboard:${studioId}`;
    await this.set(key, stats, 300);
  }
  async getDashboardStats(studioId) {
    const key = `dashboard:${studioId}`;
    return this.get(key);
  }
  async setEmailVerificationToken(email, token) {
    const key = `email_verification:${email}`;
    await this.set(key, token, 86400);
  }
  async getEmailVerificationToken(email) {
    const key = `email_verification:${email}`;
    return this.get(key);
  }
  async deleteEmailVerificationToken(email) {
    const key = `email_verification:${email}`;
    await this.del(key);
  }
  async setPasswordResetToken(email, token) {
    const key = `password_reset:${email}`;
    await this.set(key, token, 3600);
  }
  async getPasswordResetToken(email) {
    const key = `password_reset:${email}`;
    return this.get(key);
  }
  async deletePasswordResetToken(email) {
    const key = `password_reset:${email}`;
    await this.del(key);
  }
  getClient() {
    return this.redis;
  }
}
exports.CacheService = CacheService;
