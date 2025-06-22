"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceOptimizationService = void 0;
const database_service_1 = require("./database.service");
const cache_service_1 = require("./cache.service");
const logger_service_1 = require("./logger.service");
const metrics_service_1 = require("./metrics.service");
const bull_1 = __importDefault(require("bull"));
const client_1 = require("@prisma/client");
const dayjs_1 = __importDefault(require("dayjs"));
class PerformanceOptimizationService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.cache = cache_service_1.CacheService.getInstance();
    this.logger = logger_service_1.LoggerService.getInstance();
    this.metricsService = metrics_service_1.MetricsService.getInstance();
    this.SLOW_QUERY_THRESHOLD = 1000;
    this.CACHE_HIT_TARGET = 0.8;
    this.API_RESPONSE_TARGET = 200;
    this.ERROR_RATE_THRESHOLD = 0.01;
    this.performanceQueue = new bull_1.default("performance-monitoring", {
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
    });
    this.setupPerformanceMonitoring();
  }
  static getInstance() {
    if (!PerformanceOptimizationService.instance) {
      PerformanceOptimizationService.instance =
        new PerformanceOptimizationService();
    }
    return PerformanceOptimizationService.instance;
  }
  setupPerformanceMonitoring() {
    this.db.$on("query", async (e) => {
      if (e.duration > this.SLOW_QUERY_THRESHOLD) {
        await this.logSlowQuery(e.query, e.duration);
      }
      await this.metricsService.recordMetric(
        "database.query.duration",
        e.duration,
      );
    });
    this.performanceQueue.add(
      "performance-check",
      {},
      {
        repeat: {
          every: 5 * 60 * 1000,
        },
      },
    );
    this.performanceQueue.process("performance-check", async () => {
      await this.runPerformanceCheck();
    });
  }
  async getPerformanceMetrics() {
    const [database, cache, api, storage, queues] = await Promise.all([
      this.getDatabaseMetrics(),
      this.getCacheMetrics(),
      this.getAPIMetrics(),
      this.getStorageMetrics(),
      this.getQueueMetrics(),
    ]);
    return {
      database,
      cache,
      api,
      storage,
      queues,
    };
  }
  async getDatabaseMetrics() {
    const [poolStats, slowQueries, connectionInfo] = await Promise.all([
      this.db.$metrics.json(),
      this.getSlowQueries(),
      this.db.$queryRaw`
        SELECT 
          count(*) as connection_count,
          state,
          query
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state, query
      `,
    ]);
    const activeConnections = connectionInfo
      .filter((c) => c.state === "active")
      .reduce((sum, c) => sum + Number(c.connection_count), 0);
    return {
      queryTime: poolStats.counters.queries.time,
      connectionPoolSize: poolStats.counters.queries.total,
      activeConnections,
      slowQueries,
    };
  }
  async getSlowQueries() {
    const slowQueries = (await this.cache.get("slow_queries")) || [];
    return slowQueries.slice(0, 10);
  }
  async logSlowQuery(query, duration) {
    const slowQueries = (await this.cache.get("slow_queries")) || [];
    slowQueries.unshift({
      query: this.sanitizeQuery(query),
      duration,
      timestamp: new Date(),
    });
    if (slowQueries.length > 100) {
      slowQueries.length = 100;
    }
    await this.cache.set("slow_queries", slowQueries, 3600);
  }
  async getCacheMetrics() {
    const stats = await this.cache.getStats();
    return {
      hitRate: stats.hits / (stats.hits + stats.misses) || 0,
      missRate: stats.misses / (stats.hits + stats.misses) || 0,
      evictionRate: stats.evictions / stats.sets || 0,
      memoryUsage: stats.memoryUsage,
    };
  }
  async getAPIMetrics() {
    const endpointStats = await this.metricsService.getEndpointMetrics();
    const totalRequests = endpointStats.reduce((sum, e) => sum + e.calls, 0);
    const totalTime = endpointStats.reduce(
      (sum, e) => sum + e.avgTime * e.calls,
      0,
    );
    const totalErrors = endpointStats.reduce((sum, e) => sum + e.errors, 0);
    return {
      averageResponseTime: totalRequests > 0 ? totalTime / totalRequests : 0,
      requestsPerSecond: await this.metricsService.getRequestRate(),
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      endpointMetrics: endpointStats,
    };
  }
  async getStorageMetrics() {
    const [s3Usage, cdnStats] = await Promise.all([
      this.getS3Usage(),
      this.getCDNStats(),
    ]);
    return {
      s3Usage,
      cdnHitRate: cdnStats.hitRate,
      uploadSpeed: await this.metricsService.getAverageUploadSpeed(),
      downloadSpeed: await this.metricsService.getAverageDownloadSpeed(),
    };
  }
  async getQueueMetrics() {
    const jobStats = await this.performanceQueue.getJobCounts();
    const completedJobs = await this.performanceQueue.getCompleted();
    const failedJobs = await this.performanceQueue.getFailed();
    const avgProcessingTime =
      completedJobs.length > 0
        ? completedJobs.reduce(
            (sum, job) => sum + (job.finishedOn - job.processedOn),
            0,
          ) / completedJobs.length
        : 0;
    return {
      jobsProcessed: jobStats.completed,
      jobsFailed: jobStats.failed,
      avgProcessingTime,
      queueBacklog: jobStats.waiting + jobStats.delayed,
    };
  }
  async runPerformanceCheck() {
    const metrics = await this.getPerformanceMetrics();
    const suggestions = this.generateOptimizationSuggestions(metrics);
    if (suggestions.filter((s) => s.impact === "high").length > 0) {
      await this.notifyAdminsOfPerformanceIssues(suggestions);
    }
    await this.storeMetricsHistory(metrics);
    await this.applyAutoOptimizations(metrics, suggestions);
  }
  generateOptimizationSuggestions(metrics) {
    const suggestions = [];
    if (metrics.database.slowQueries.length > 5) {
      suggestions.push({
        area: "Database",
        issue: `${metrics.database.slowQueries.length} slow queries detected`,
        impact: "high",
        suggestion: "Add indexes for frequently queried columns",
        estimatedImprovement: "50-70% query time reduction",
      });
    }
    if (
      metrics.database.activeConnections >
      metrics.database.connectionPoolSize * 0.8
    ) {
      suggestions.push({
        area: "Database",
        issue: "Connection pool near capacity",
        impact: "medium",
        suggestion: "Increase connection pool size",
        estimatedImprovement: "Prevent connection timeouts",
      });
    }
    if (metrics.cache.hitRate < this.CACHE_HIT_TARGET) {
      suggestions.push({
        area: "Cache",
        issue: `Cache hit rate ${(metrics.cache.hitRate * 100).toFixed(1)}% below target`,
        impact: "medium",
        suggestion: "Review cache TTL and warming strategies",
        estimatedImprovement: "30-40% reduction in database queries",
      });
    }
    if (metrics.cache.evictionRate > 0.1) {
      suggestions.push({
        area: "Cache",
        issue: "High cache eviction rate",
        impact: "medium",
        suggestion: "Increase cache memory allocation",
        estimatedImprovement: "Better cache retention",
      });
    }
    if (metrics.api.averageResponseTime > this.API_RESPONSE_TARGET) {
      suggestions.push({
        area: "API",
        issue: `Average response time ${metrics.api.averageResponseTime}ms exceeds target`,
        impact: "high",
        suggestion: "Optimize slow endpoints and implement response caching",
        estimatedImprovement: "40-50% response time improvement",
      });
    }
    if (metrics.api.errorRate > this.ERROR_RATE_THRESHOLD) {
      suggestions.push({
        area: "API",
        issue: `Error rate ${(metrics.api.errorRate * 100).toFixed(2)}% exceeds threshold`,
        impact: "high",
        suggestion: "Review error logs and implement better error handling",
        estimatedImprovement: "Improved reliability",
      });
    }
    if (metrics.storage.cdnHitRate < 0.8) {
      suggestions.push({
        area: "Storage",
        issue: "Low CDN hit rate",
        impact: "low",
        suggestion: "Review CDN cache headers and TTL settings",
        estimatedImprovement: "20-30% faster asset delivery",
      });
    }
    if (metrics.queues.queueBacklog > 1000) {
      suggestions.push({
        area: "Queues",
        issue: "Large job backlog",
        impact: "medium",
        suggestion: "Scale up workers or optimize job processing",
        estimatedImprovement: "Faster background job completion",
      });
    }
    return suggestions;
  }
  async applyAutoOptimizations(metrics, suggestions) {
    if (metrics.queues.queueBacklog > 2000) {
      await this.scaleWorkers("up");
    } else if (metrics.queues.queueBacklog < 100) {
      await this.scaleWorkers("down");
    }
    if (metrics.cache.hitRate < 0.5) {
      await this.warmCache();
    }
    if (
      metrics.database.activeConnections >
      metrics.database.connectionPoolSize * 0.9
    ) {
      await this.optimizeDatabaseConnections();
    }
  }
  async optimizeQueries(studioId) {
    const queryPatterns = await this.db.$queryRaw`
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        stddev_time
      FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat_statements%'
      ORDER BY total_time DESC
      LIMIT 20
    `;
    const indexSuggestions = await this.generateIndexSuggestions(queryPatterns);
    for (const suggestion of indexSuggestions) {
      try {
        await this.db.$executeRawUnsafe(suggestion.sql);
        this.logger.info(`Created index: ${suggestion.name}`);
      } catch (error) {
        this.logger.error(`Failed to create index: ${suggestion.name}`, error);
      }
    }
    return {
      analyzedQueries: queryPatterns.length,
      suggestedIndexes: indexSuggestions.length,
      createdIndexes: indexSuggestions.filter((s) => s.created).length,
    };
  }
  async optimizeImages(studioId) {
    const unoptimizedImages = await this.db.file.findMany({
      where: {
        project: { studioId },
        type: "IMAGE",
        metadata: {
          path: ["optimized"],
          equals: client_1.Prisma.DbNull,
        },
      },
      take: 100,
    });
    let optimizedCount = 0;
    let savedBytes = 0;
    for (const image of unoptimizedImages) {
      try {
        const optimized = await this.optimizeImage(image);
        if (optimized.savedBytes > 0) {
          optimizedCount++;
          savedBytes += optimized.savedBytes;
        }
      } catch (error) {
        this.logger.error(`Failed to optimize image ${image.id}:`, error);
      }
    }
    return {
      processed: unoptimizedImages.length,
      optimized: optimizedCount,
      savedMB: (savedBytes / 1048576).toFixed(2),
    };
  }
  async warmCache() {
    const frequentQueries = [
      async () => {
        const studios = await this.db.studio.findMany({
          where: { deletedAt: null },
          take: 100,
        });
        for (const studio of studios) {
          await this.cache.set(`studio:${studio.id}`, studio, 3600);
        }
      },
      async () => {
        const bookings = await this.db.booking.findMany({
          where: {
            startDateTime: {
              gte: (0, dayjs_1.default)().subtract(30, "days").toDate(),
            },
          },
          include: { client: true, assignments: true },
          take: 500,
        });
        for (const booking of bookings) {
          await this.cache.set(`booking:${booking.id}`, booking, 1800);
        }
      },
      async () => {
        const projects = await this.db.project.findMany({
          where: {
            status: { in: ["IN_PROGRESS", "IN_EDITING"] },
          },
          include: { client: true, assignments: true },
          take: 200,
        });
        for (const project of projects) {
          await this.cache.set(`project:${project.id}`, project, 1800);
        }
      },
    ];
    await Promise.all(frequentQueries.map((fn) => fn()));
  }
  sanitizeQuery(query) {
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
      .replace(/\d{4,}/g, "####");
  }
  async getS3Usage() {
    return 1024 * 1024 * 1024 * 50;
  }
  async getCDNStats() {
    return { hitRate: 0.85 };
  }
  async scaleWorkers(direction) {
    this.logger.info(`Scaling workers ${direction}`);
  }
  async optimizeDatabaseConnections() {
    await this.db.$queryRaw`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE state = 'idle'
        AND state_change < NOW() - INTERVAL '10 minutes'
    `;
  }
  async generateIndexSuggestions(queryPatterns) {
    const suggestions = [];
    for (const pattern of queryPatterns) {
      const whereMatch = pattern.query.match(/WHERE\s+(\w+\.)?(\w+)\s*=/i);
      const joinMatch = pattern.query.match(
        /JOIN\s+.*\s+ON\s+(\w+\.)?(\w+)\s*=/i,
      );
      if (whereMatch || joinMatch) {
        const column = whereMatch?.[2] || joinMatch?.[2];
        const table = this.extractTableFromQuery(pattern.query);
        if (table && column) {
          suggestions.push({
            name: `idx_${table}_${column}`,
            sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${table}_${column} ON "${table}" ("${column}")`,
            created: false,
          });
        }
      }
    }
    return suggestions;
  }
  extractTableFromQuery(query) {
    const match = query.match(/FROM\s+"?(\w+)"?/i);
    return match?.[1] || null;
  }
  async optimizeImage(file) {
    return { savedBytes: Math.floor(Number(file.size) * 0.3) };
  }
  async storeMetricsHistory(metrics) {
    const key = `metrics:${(0, dayjs_1.default)().format("YYYY-MM-DD:HH")}`;
    await this.cache.set(key, metrics, 86400 * 7);
  }
  async notifyAdminsOfPerformanceIssues(suggestions) {
    const highImpactIssues = suggestions.filter((s) => s.impact === "high");
    if (highImpactIssues.length === 0) return;
    const admins = await this.db.user.findMany({
      where: {
        role: { in: ["SUPER_ADMIN", "STUDIO_ADMIN"] },
        deletedAt: null,
      },
    });
    for (const admin of admins) {
      await this.db.notification.create({
        data: {
          userId: admin.id,
          type: "SYSTEM_ALERT",
          title: "Performance Issues Detected",
          message: `${highImpactIssues.length} high-impact performance issues require attention`,
          actionUrl: "/admin/performance",
          metadata: {
            issues: highImpactIssues,
          },
        },
      });
    }
  }
  async runFullOptimization(studioId) {
    const results = {
      database: await this.optimizeQueries(studioId || "all"),
      images: studioId
        ? await this.optimizeImages(studioId)
        : { processed: 0, optimized: 0, savedMB: 0 },
      cache: await this.rebuildCache(),
      cleanup: await this.cleanupOldData(),
    };
    return results;
  }
  async rebuildCache() {
    await this.cache.flushAll();
    await this.warmCache();
    return { rebuilt: true };
  }
  async cleanupOldData() {
    const [sessions, logs, notifications] = await Promise.all([
      this.db.userSession.deleteMany({
        where: {
          refreshExpiresAt: { lt: new Date() },
        },
      }),
      this.db.auditLog.deleteMany({
        where: {
          createdAt: {
            lt: (0, dayjs_1.default)().subtract(90, "days").toDate(),
          },
        },
      }),
      this.db.notification.deleteMany({
        where: {
          isRead: true,
          createdAt: {
            lt: (0, dayjs_1.default)().subtract(30, "days").toDate(),
          },
        },
      }),
    ]);
    return {
      sessions: sessions.count,
      logs: logs.count,
      notifications: notifications.count,
    };
  }
}
exports.PerformanceOptimizationService = PerformanceOptimizationService;
