// packages/backend/src/services/performanceOptimization.service.ts
// FIXED VERSION with all bugs resolved

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import sharp from 'sharp'; // Added proper image optimization library
import Bull from 'bull';

interface PerformanceMetrics {
  database: {
    connectionPoolSize: number;
    activeConnections: number;
    slowQueries: any[];
    averageQueryTime: number;
    cacheHitRatio: number;
  };
  cache: {
    hitRate: number;
    evictionRate: number;
    memoryUsage: number;
    keyCount: number;
  };
  api: {
    averageResponseTime: number;
    errorRate: number;
    requestsPerSecond: number;
    slowEndpoints: any[];
  };
  storage: {
    totalUsage: number;
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
  impact: 'low' | 'medium' | 'high' | 'critical';
  suggestion: string;
  estimatedImprovement: string;
  autoApplicable?: boolean;
  priority: number;
}

interface IndexSuggestion {
  name: string;
  sql: string;
  created: boolean;
  estimatedImpact: string;
  affectedTables: string[];
}

@Injectable()
export class PerformanceOptimizationService {
  private readonly logger = new Logger(PerformanceOptimizationService.name);
  
  // Enhanced thresholds with validation
  private readonly CACHE_HIT_TARGET = 0.85;
  private readonly API_RESPONSE_TARGET = 500; // ms
  private readonly ERROR_RATE_THRESHOLD = 0.01; // 1%
  private readonly DB_CONNECTION_THRESHOLD = 0.8; // 80% of pool
  private readonly QUEUE_BACKLOG_THRESHOLD = 1000;
  
  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // ms
  
  constructor(
    private readonly db: PrismaClient,
    private readonly cache: Redis,
    private readonly queue: Bull.Queue,
  ) {
    this.initializePerformanceMonitoring();
  }

  /**
   * Initialize performance monitoring with proper error handling
   */
  private async initializePerformanceMonitoring() {
    try {
      // Run performance check every 5 minutes
      setInterval(async () => {
        try {
          await this.runPerformanceCheck();
        } catch (error) {
          this.logger.error('Performance check failed:', error);
          // Continue monitoring even if one check fails
        }
      }, 5 * 60 * 1000);

      // Run optimization every hour
      setInterval(async () => {
        try {
          await this.runAutomaticOptimizations();
        } catch (error) {
          this.logger.error('Automatic optimization failed:', error);
        }
      }, 60 * 60 * 1000);

      this.logger.log('Performance monitoring initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize performance monitoring:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive performance metrics with proper error handling
   */
  public async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    try {
      const [
        databaseMetrics,
        cacheMetrics,
        apiMetrics,
        storageMetrics,
        queueMetrics,
      ] = await Promise.allSettled([
        this.getDatabaseMetrics(),
        this.getCacheMetrics(),
        this.getApiMetrics(),
        this.getStorageMetrics(),
        this.getQueueMetrics(),
      ]);

      return {
        database: databaseMetrics.status === 'fulfilled' ? databaseMetrics.value : this.getDefaultDatabaseMetrics(),
        cache: cacheMetrics.status === 'fulfilled' ? cacheMetrics.value : this.getDefaultCacheMetrics(),
        api: apiMetrics.status === 'fulfilled' ? apiMetrics.value : this.getDefaultApiMetrics(),
        storage: storageMetrics.status === 'fulfilled' ? storageMetrics.value : this.getDefaultStorageMetrics(),
        queues: queueMetrics.status === 'fulfilled' ? queueMetrics.value : this.getDefaultQueueMetrics(),
      };
    } catch (error) {
      this.logger.error('Failed to get performance metrics:', error);
      throw new Error('Unable to retrieve performance metrics');
    }
  }

  /**
   * FIXED: Implement actual image optimization using Sharp
   */
  private async optimizeImage(file: Express.Multer.File): Promise<{ savedBytes: number; optimizedPath: string }> {
    try {
      if (!file || !file.buffer) {
        throw new Error('Invalid file provided for optimization');
      }

      const originalSize = file.buffer.length;
      let optimizedBuffer: Buffer;

      // Determine optimization strategy based on file type
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      if (!metadata.format) {
        throw new Error('Unable to determine image format');
      }

      switch (metadata.format) {
        case 'jpeg':
          optimizedBuffer = await image
            .jpeg({ quality: 85, progressive: true, mozjpeg: true })
            .toBuffer();
          break;
        case 'png':
          optimizedBuffer = await image
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
          break;
        case 'webp':
          optimizedBuffer = await image
            .webp({ quality: 85, effort: 6 })
            .toBuffer();
          break;
        default:
          // Convert unsupported formats to WebP
          optimizedBuffer = await image
            .webp({ quality: 85, effort: 6 })
            .toBuffer();
      }

      const savedBytes = originalSize - optimizedBuffer.length;
      const optimizedPath = `optimized_${Date.now()}_${file.originalname}`;

      // Save optimized file (implementation depends on your storage strategy)
      await this.saveOptimizedImage(optimizedBuffer, optimizedPath);

      this.logger.log(`Image optimized: ${savedBytes} bytes saved (${((savedBytes / originalSize) * 100).toFixed(2)}% reduction)`);

      return {
        savedBytes: Math.max(0, savedBytes), // Ensure non-negative
        optimizedPath,
      };
    } catch (error) {
      this.logger.error('Image optimization failed:', error);
      throw new Error(`Image optimization failed: ${error.message}`);
    }
  }

  /**
   * FIXED: Enhanced database optimization with proper error handling
   */
  public async optimizeQueries(studioId: string): Promise<{
    analyzedQueries: number;
    suggestedIndexes: number;
    createdIndexes: number;
    optimizationErrors: string[];
  }> {
    const errors: string[] = [];
    let analyzedQueries = 0;
    let suggestedIndexes = 0;
    let createdIndexes = 0;

    try {
      // Validate input
      if (!studioId || (studioId !== 'all' && typeof studioId !== 'string')) {
        throw new Error('Invalid studioId provided');
      }

      // Check if pg_stat_statements extension is available
      const extensionCheck = await this.db.$queryRaw<any[]>`
        SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements'
      `;

      if (extensionCheck.length === 0) {
        this.logger.warn('pg_stat_statements extension not available, skipping query analysis');
        return { analyzedQueries: 0, suggestedIndexes: 0, createdIndexes: 0, optimizationErrors: ['pg_stat_statements extension not available'] };
      }

      // Analyze query patterns with better error handling
      const queryPatterns = await this.retryOperation(async () => {
        return await this.db.$queryRaw<any[]>`
          SELECT 
            query,
            calls,
            total_time,
            mean_time,
            stddev_time,
            rows,
            100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
          FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat_statements%'
            AND query NOT LIKE '%EXPLAIN%'
            AND calls > 10
          ORDER BY total_time DESC
          LIMIT 50
        `;
      });

      analyzedQueries = queryPatterns.length;

      // Generate index suggestions with enhanced logic
      const indexSuggestions = await this.generateEnhancedIndexSuggestions(queryPatterns);
      suggestedIndexes = indexSuggestions.length;

      // Create indexes with proper transaction handling
      for (const suggestion of indexSuggestions) {
        try {
          await this.db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(suggestion.sql);
          });
          
          createdIndexes++;
          this.logger.log(`Successfully created index: ${suggestion.name}`);
        } catch (error) {
          const errorMsg = `Failed to create index ${suggestion.name}: ${error.message}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      return {
        analyzedQueries,
        suggestedIndexes,
        createdIndexes,
        optimizationErrors: errors,
      };
    } catch (error) {
      this.logger.error('Query optimization failed:', error);
      errors.push(`Query optimization failed: ${error.message}`);
      return {
        analyzedQueries,
        suggestedIndexes,
        createdIndexes,
        optimizationErrors: errors,
      };
    }
  }

  /**
   * FIXED: Enhanced index suggestion generation
   */
  private async generateEnhancedIndexSuggestions(queryPatterns: any[]): Promise<IndexSuggestion[]> {
    const suggestions: IndexSuggestion[] = [];

    for (const pattern of queryPatterns) {
      try {
        const query = pattern.query.toLowerCase();
        
        // Enhanced pattern matching for different types of queries
        const indexPatterns = [
          { regex