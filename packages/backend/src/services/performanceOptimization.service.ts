// packages/backend/src/services/performanceOptimization.service.ts
import { DatabaseService } from './database.service';
import { CacheService } from './cache.service';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';
import Bull from 'bull';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';

interface PerformanceMetrics {
  database: {
    queryTime: number;
    connectionPoolSize: number;
    activeConnections: number;
    slowQueries: Array<{
      query: string;
      duration: number;
      timestamp: Date;
    }>;
  };
  cache: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
    memoryUsage: number;
  };
  api: {
    averageResponseTime: number;
    requestsPerSecond: number;
    errorRate: number;
    endpointMetrics: Array<{
      endpoint: string;
      avgTime: number;
      calls: number;
      errors: number;
    }>;
  };
  storage: {
    s3Usage: number;
    cdnHitRate: number;
    uploadSpeed: number;
    downloadSpeed: number;
  };
  queues: {
    jobsProcessed: number;
    jobsFailed: number;
    avgProcessingTime: number;
    queueBacklog: number;
  };
}

interface OptimizationSuggestion {
  area: string;
  issue: string;
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
  estimatedImprovement: string;
}

export class PerformanceOptimizationService {
  private static instance: PerformanceOptimizationService;
  private db = DatabaseService.getInstance().getClient();
  private cache = CacheService.getInstance();
  private logger = LoggerService.getInstance();
  private metricsService = MetricsService.getInstance();
  private performanceQueue: Bull.Queue;

  private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
  private readonly CACHE_HIT_TARGET = 0.8; // 80% hit rate
  private readonly API_RESPONSE_TARGET = 200; // 200ms
  private readonly ERROR_RATE_THRESHOLD = 0.01; // 1% error rate

  private constructor() {
    this.performanceQueue = new Bull('performance-monitoring', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });

    this.setupPerformanceMonitoring();
  }

  public static getInstance(): PerformanceOptimizationService {
    if (!PerformanceOptimizationService.instance) {
      PerformanceOptimizationService.instance = new PerformanceOptimizationService();
    }
    return PerformanceOptimizationService.instance;
  }

  private setupPerformanceMonitoring() {
    // Monitor database performance
    this.db.$on('query' as any, async (e: any) => {
      if (e.duration > this.SLOW_QUERY_THRESHOLD) {
        await this.logSlowQuery(e.query, e.duration);
      }
      
      await this.metricsService.recordMetric('database.query.duration', e.duration);
    });

    // Schedule regular performance checks
    this.performanceQueue.add(
      'performance-check',
      {},
      {
        repeat: {
          every: 5 * 60 * 1000, // Every 5 minutes
        },
      }
    );

    this.performanceQueue.process('performance-check', async () => {
      await this.runPerformanceCheck();
    });
  }

  // Get current performance metrics
  public async getPerformanceMetrics(): Promise<PerformanceMetrics> {
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

  // Database optimization
  private async getDatabaseMetrics() {
    const [poolStats, slowQueries, connectionInfo] = await Promise.all([
      this.db.$metrics.json(),
      this.getSlowQueries(),
      this.db.$queryRaw<any[]>`
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
      .filter(c => c.state === 'active')
      .reduce((sum, c) => sum + Number(c.connection_count), 0);

    return {
      queryTime: poolStats.counters.queries.time,
      connectionPoolSize: poolStats.counters.queries.total,
      activeConnections,
      slowQueries,
    };
  }

  private async getSlowQueries() {
    const slowQueries = await this.cache.get<any[]>('slow_queries') || [];
    return slowQueries.slice(0, 10); // Return top 10 slow queries
  }

  private async logSlowQuery(query: string, duration: number) {
    const slowQueries = await this.cache.get<any[]>('slow_queries') || [];
    
    slowQueries.unshift({
      query: this.sanitizeQuery(query),
      duration,
      timestamp: new Date(),
    });

    // Keep only last 100 slow queries
    if (slowQueries.length > 100) {
      slowQueries.length = 100;
    }

    await this.cache.set('slow_queries', slowQueries, 3600); // 1 hour
  }

  // Cache optimization
  private async getCacheMetrics() {
    const stats = await this.cache.getStats();
    
    return {
      hitRate: stats.hits / (stats.hits + stats.misses) || 0,
      missRate: stats.misses / (stats.hits + stats.misses) || 0,
      evictionRate: stats.evictions / stats.sets || 0,
      memoryUsage: stats.memoryUsage,
    };
  }

  // API performance
  private async getAPIMetrics() {
    const endpointStats = await this.metricsService.getEndpointMetrics();
    
    const totalRequests = endpointStats.reduce((sum, e) => sum + e.calls, 0);
    const totalTime = endpointStats.reduce((sum, e) => sum + (e.avgTime * e.calls), 0);
    const totalErrors = endpointStats.reduce((sum, e) => sum + e.errors, 0);

    return {
      averageResponseTime: totalRequests > 0 ? totalTime / totalRequests : 0,
      requestsPerSecond: await this.metricsService.getRequestRate(),
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      endpointMetrics: endpointStats,
    };
  }

  // Storage metrics
  private async getStorageMetrics() {
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

  // Queue metrics
  private async getQueueMetrics() {
    const jobStats = await this.performanceQueue.getJobCounts();
    const completedJobs = await this.performanceQueue.getCompleted();
    const failedJobs = await this.performanceQueue.getFailed();

    const avgProcessingTime = completedJobs.length > 0
      ? completedJobs.reduce((sum, job) => sum + (job.finishedOn! - job.processedOn!), 0) / completedJobs.length
      : 0;

    return {
      jobsProcessed: jobStats.completed,
      jobsFailed: jobStats.failed,
      avgProcessingTime,
      queueBacklog: jobStats.waiting + jobStats.delayed,
    };
  }

  // Run performance check and generate suggestions
  private async runPerformanceCheck() {
    const metrics = await this.getPerformanceMetrics();
    const suggestions = this.generateOptimizationSuggestions(metrics);

    if (suggestions.filter(s => s.impact === 'high').length > 0) {
      await this.notifyAdminsOfPerformanceIssues(suggestions);
    }

    // Store metrics history
    await this.storeMetricsHistory(metrics);

    // Auto-apply certain optimizations
    await this.applyAutoOptimizations(metrics, suggestions);
  }

  // Generate optimization suggestions
  private generateOptimizationSuggestions(metrics: PerformanceMetrics): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Database suggestions
    if (metrics.database.slowQueries.length > 5) {
      suggestions.push({
        area: 'Database',
        issue: `${metrics.database.slowQueries.length} slow queries detected`,
        impact: 'high',
        suggestion: 'Add indexes for frequently queried columns',
        estimatedImprovement: '50-70% query time reduction',
      });
    }

    if (metrics.database.activeConnections > metrics.database.connectionPoolSize * 0.8) {
      suggestions.push({
        area: 'Database',
        issue: 'Connection pool near capacity',
        impact: 'medium',
        suggestion: 'Increase connection pool size',
        estimatedImprovement: 'Prevent connection timeouts',
      });
    }

    // Cache suggestions
    if (metrics.cache.hitRate < this.CACHE_HIT_TARGET) {
      suggestions.push({
        area: 'Cache',
        issue: `Cache hit rate ${(metrics.cache.hitRate * 100).toFixed(1)}% below target`,
        impact: 'medium',
        suggestion: 'Review cache TTL and warming strategies',
        estimatedImprovement: '30-40% reduction in database queries',
      });
    }

    if (metrics.cache.evictionRate > 0.1) {
      suggestions.push({
        area: 'Cache',
        issue: 'High cache eviction rate',
        impact: 'medium',
        suggestion: 'Increase cache memory allocation',
        estimatedImprovement: 'Better cache retention',
      });
    }

    // API suggestions
    if (metrics.api.averageResponseTime > this.API_RESPONSE_TARGET) {
      suggestions.push({
        area: 'API',
        issue: `Average response time ${metrics.api.averageResponseTime}ms exceeds target`,
        impact: 'high',
        suggestion: 'Optimize slow endpoints and implement response caching',
        estimatedImprovement: '40-50% response time improvement',
      });
    }

    if (metrics.api.errorRate > this.ERROR_RATE_THRESHOLD) {
      suggestions.push({
        area: 'API',
        issue: `Error rate ${(metrics.api.errorRate * 100).toFixed(2)}% exceeds threshold`,
        impact: 'high',
        suggestion: 'Review error logs and implement better error handling',
        estimatedImprovement: 'Improved reliability',
      });
    }

    // Storage suggestions
    if (metrics.storage.cdnHitRate < 0.8) {
      suggestions.push({
        area: 'Storage',
        issue: 'Low CDN hit rate',
        impact: 'low',
        suggestion: 'Review CDN cache headers and TTL settings',
        estimatedImprovement: '20-30% faster asset delivery',
      });
    }

    // Queue suggestions
    if (metrics.queues.queueBacklog > 1000) {
      suggestions.push({
        area: 'Queues',
        issue: 'Large job backlog',
        impact: 'medium',
        suggestion: 'Scale up workers or optimize job processing',
        estimatedImprovement: 'Faster background job completion',
      });
    }

    return suggestions;
  }

  // Apply automatic optimizations
  private async applyAutoOptimizations(
    metrics: PerformanceMetrics,
    suggestions: OptimizationSuggestion[]
  ) {
    // Auto-scale workers if queue backlog is high
    if (metrics.queues.queueBacklog > 2000) {
      await this.scaleWorkers('up');
    } else if (metrics.queues.queueBacklog < 100) {
      await this.scaleWorkers('down');
    }

    // Clear cache for underperforming queries
    if (metrics.cache.hitRate < 0.5) {
      await this.warmCache();
    }

    // Optimize database connections
    if (metrics.database.activeConnections > metrics.database.connectionPoolSize * 0.9) {
      await this.optimizeDatabaseConnections();
    }
  }

  // Database query optimization
  public async optimizeQueries(studioId: string) {
    // Analyze query patterns
    const queryPatterns = await this.db.$queryRaw<any[]>`
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

    // Generate index suggestions
    const indexSuggestions = await this.generateIndexSuggestions(queryPatterns);

    // Create missing indexes
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
      createdIndexes: indexSuggestions.filter(s => s.created).length,
    };
  }

  // Image optimization
  public async optimizeImages(studioId: string) {
    const unoptimizedImages = await this.db.file.findMany({
      where: {
        project: { studioId },
        type: 'IMAGE',
        metadata: {
          path: ['optimized'],
          equals: Prisma.DbNull,
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

  // Cache warming
  private async warmCache() {
    // Warm frequently accessed data
    const frequentQueries = [
      // Studio data
      async () => {
        const studios = await this.db.studio.findMany({
          where: { deletedAt: null },
          take: 100,
        });
        for (const studio of studios) {
          await this.cache.set(`studio:${studio.id}`, studio, 3600);
        }
      },
      // Recent bookings
      async () => {
        const bookings = await this.db.booking.findMany({
          where: {
            startDateTime: { gte: dayjs().subtract(30, 'days').toDate() },
          },
          include: { client: true, assignments: true },
          take: 500,
        });
        for (const booking of bookings) {
          await this.cache.set(`booking:${booking.id}`, booking, 1800);
        }
      },
      // Active projects
      async () => {
        const projects = await this.db.project.findMany({
          where: {
            status: { in: ['IN_PROGRESS', 'IN_EDITING'] },
          },
          include: { client: true, assignments: true },
          take: 200,
        });
        for (const project of projects) {
          await this.cache.set(`project:${project.id}`, project, 1800);
        }
      },
    ];

    await Promise.all(frequentQueries.map(fn => fn()));
  }

  // Helper methods
  private sanitizeQuery(query: string): string {
    // Remove sensitive data from queries
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
      .replace(/\d{4,}/g, '####'); // Hide long numbers
  }

  private async getS3Usage(): Promise<number> {
    // This would connect to AWS to get actual usage
    // For now, returning mock data
    return 1024 * 1024 * 1024 * 50; // 50GB
  }

  private async getCDNStats(): Promise<{ hitRate: number }> {
    // This would connect to CDN provider for actual stats
    // For now, returning mock data
    return { hitRate: 0.85 };
  }

  private async scaleWorkers(direction: 'up' | 'down') {
    // Implementation for auto-scaling workers
    this.logger.info(`Scaling workers ${direction}`);
  }

  private async optimizeDatabaseConnections() {
    // Close idle connections
    await this.db.$queryRaw`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE state = 'idle'
        AND state_change < NOW() - INTERVAL '10 minutes'
    `;
  }

  private async generateIndexSuggestions(queryPatterns: any[]): Promise<any[]> {
    const suggestions = [];

    for (const pattern of queryPatterns) {
      // Analyze WHERE clauses and JOIN conditions
      const whereMatch = pattern.query.match(/WHERE\s+(\w+\.)?(\w+)\s*=/i);
      const joinMatch = pattern.query.match(/JOIN\s+.*\s+ON\s+(\w+\.)?(\w+)\s*=/i);

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

  private extractTableFromQuery(query: string): string | null {
    const match = query.match(/FROM\s+"?(\w+)"?/i);
    return match?.[1] || null;
  }

  private async optimizeImage(file: any): Promise<{ savedBytes: number }> {
    // Implementation would use sharp or similar library to optimize images
    // For now, returning mock data
    return { savedBytes: Math.floor(Number(file.size) * 0.3) };
  }

  private async storeMetricsHistory(metrics: PerformanceMetrics) {
    const key = `metrics:${dayjs().format('YYYY-MM-DD:HH')}`;
    await this.cache.set(key, metrics, 86400 * 7); // Keep for 7 days
  }

  private async notifyAdminsOfPerformanceIssues(suggestions: OptimizationSuggestion[]) {
    const highImpactIssues = suggestions.filter(s => s.impact === 'high');
    
    if (highImpactIssues.length === 0) return;

    // Send notification to admin users
    const admins = await this.db.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'STUDIO_ADMIN'] },
        deletedAt: null,
      },
    });

    for (const admin of admins) {
      await this.db.notification.create({
        data: {
          userId: admin.id,
          type: 'SYSTEM_ALERT',
          title: 'Performance Issues Detected',
          message: `${highImpactIssues.length} high-impact performance issues require attention`,
          actionUrl: '/admin/performance',
          metadata: {
            issues: highImpactIssues,
          },
        },
      });
    }
  }

  // Public methods for manual optimization
  public async runFullOptimization(studioId?: string) {
    const results = {
      database: await this.optimizeQueries(studioId || 'all'),
      images: studioId ? await this.optimizeImages(studioId) : { processed: 0, optimized: 0, savedMB: 0 },
      cache: await this.rebuildCache(),
      cleanup: await this.cleanupOldData(),
    };

    return results;
  }

  private async rebuildCache() {
    await this.cache.flushAll();
    await this.warmCache();
    return { rebuilt: true };
  }

  private async cleanupOldData() {
    const [sessions, logs, notifications] = await Promise.all([
      // Clean expired sessions
      this.db.userSession.deleteMany({
        where: {
          refreshExpiresAt: { lt: new Date() },
        },
      }),
      // Clean old audit logs
      this.db.auditLog.deleteMany({
        where: {
          createdAt: { lt: dayjs().subtract(90, 'days').toDate() },
        },
      }),
      // Clean read notifications
      this.db.notification.deleteMany({
        where: {
          isRead: true,
          createdAt: { lt: dayjs().subtract(30, 'days').toDate() },
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