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
export declare class PerformanceOptimizationService {
  private static instance;
  private db;
  private cache;
  private logger;
  private metricsService;
  private performanceQueue;
  private readonly SLOW_QUERY_THRESHOLD;
  private readonly CACHE_HIT_TARGET;
  private readonly API_RESPONSE_TARGET;
  private readonly ERROR_RATE_THRESHOLD;
  private constructor();
  static getInstance(): PerformanceOptimizationService;
  private setupPerformanceMonitoring;
  getPerformanceMetrics(): Promise<PerformanceMetrics>;
  private getDatabaseMetrics;
  private getSlowQueries;
  private logSlowQuery;
  private getCacheMetrics;
  private getAPIMetrics;
  private getStorageMetrics;
  private getQueueMetrics;
  private runPerformanceCheck;
  private generateOptimizationSuggestions;
  private applyAutoOptimizations;
  optimizeQueries(studioId: string): Promise<{
    analyzedQueries: any;
    suggestedIndexes: number;
    createdIndexes: number;
  }>;
  optimizeImages(studioId: string): Promise<{
    processed: any;
    optimized: number;
    savedMB: string;
  }>;
  private warmCache;
  private sanitizeQuery;
  private getS3Usage;
  private getCDNStats;
  private scaleWorkers;
  private optimizeDatabaseConnections;
  private generateIndexSuggestions;
  private extractTableFromQuery;
  private optimizeImage;
  private storeMetricsHistory;
  private notifyAdminsOfPerformanceIssues;
  runFullOptimization(studioId?: string): Promise<{
    database: {
      analyzedQueries: any;
      suggestedIndexes: number;
      createdIndexes: number;
    };
    images:
      | {
          processed: any;
          optimized: number;
          savedMB: string;
        }
      | {
          processed: number;
          optimized: number;
          savedMB: number;
        };
    cache: {
      rebuilt: boolean;
    };
    cleanup: {
      sessions: any;
      logs: any;
      notifications: any;
    };
  }>;
  private rebuildCache;
  private cleanupOldData;
}
export {};
