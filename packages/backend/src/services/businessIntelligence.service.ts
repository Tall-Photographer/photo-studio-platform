// packages/backend/src/services/businessIntelligence.service.ts
import { DatabaseService } from './database.service';
import { CacheService } from './cache.service';
import { LoggerService } from './logger.service';
import dayjs from 'dayjs';
import { Prisma } from '@prisma/client';

interface DashboardMetrics {
  revenue: {
    current: number;
    previous: number;
    growth: number;
    trend: Array<{ date: string; amount: number }>;
  };
  bookings: {
    total: number;
    completed: number;
    upcoming: number;
    cancelled: number;
    trend: Array<{ date: string; count: number }>;
  };
  clients: {
    total: number;
    new: number;
    returning: number;
    vip: number;
    retentionRate: number;
  };
  team: {
    totalMembers: number;
    utilization: number;
    topPerformers: Array<{
      user: any;
      metrics: {
        bookings: number;
        revenue: number;
        rating: number;
      };
    }>;
  };
  equipment: {
    total: number;
    available: number;
    utilization: number;
    maintenanceNeeded: number;
    valueDepreciation: number;
  };
}

interface PerformanceMetrics {
  kpis: Array<{
    name: string;
    value: number;
    target: number;
    achievement: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  conversionFunnel: {
    inquiries: number;
    bookings: number;
    completed: number;
    reviews: number;
  };
  servicePerformance: Array<{
    service: string;
    bookings: number;
    revenue: number;
    avgPrice: number;
    growth: number;
  }>;
  seasonalTrends: Array<{
    month: string;
    bookings: number;
    revenue: number;
    avgBookingValue: number;
  }>;
}

interface PredictiveAnalytics {
  revenueForeccast: Array<{
    month: string;
    predicted: number;
    confidence: { low: number; high: number };
  }>;
  demandForecast: Array<{
    date: string;
    predictedBookings: number;
    recommendedStaff: number;
  }>;
  churnRisk: Array<{
    client: any;
    riskScore: number;
    lastBooking: Date;
    factors: string[];
  }>;
  pricingRecommendations: Array<{
    service: string;
    currentPrice: number;
    recommendedPrice: number;
    estimatedImpact: number;
  }>;
}

interface CompetitorAnalysis {
  marketPosition: {
    pricePosition: 'below' | 'average' | 'above';
    serviceOfferings: number;
    uniqueServices: string[];
  };
  pricingComparison: Array<{
    service: string;
    ourPrice: number;
    marketAverage: number;
    difference: number;
  }>;
  marketTrends: Array<{
    trend: string;
    adoption: number;
    opportunity: string;
  }>;
}

export class BusinessIntelligenceService {
  private static instance: BusinessIntelligenceService;
  private db = DatabaseService.getInstance().getClient();
  private cache = CacheService.getInstance();
  private logger = LoggerService.getInstance();

  private constructor() {}

  public static getInstance(): BusinessIntelligenceService {
    if (!BusinessIntelligenceService.instance) {
      BusinessIntelligenceService.instance = new BusinessIntelligenceService();
    }
    return BusinessIntelligenceService.instance;
  }

  // Get dashboard metrics
  public async getDashboardMetrics(
    studioId: string,
    period: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'month'
  ): Promise<DashboardMetrics> {
    // Check cache first
    const cacheKey = `dashboard:${studioId}:${period}`;
    const cached = await this.cache.get<DashboardMetrics>(cacheKey);
    if (cached) {
      return cached;
    }

    const { currentStart, currentEnd, previousStart, previousEnd } = this.getPeriodDates(period);

    const [
      revenue,
      bookings,
      clients,
      team,
      equipment,
    ] = await Promise.all([
      this.getRevenueMetrics(studioId, currentStart, currentEnd, previousStart, previousEnd),
      this.getBookingMetrics(studioId, currentStart, currentEnd),
      this.getClientMetrics(studioId, currentStart, currentEnd),
      this.getTeamMetrics(studioId, currentStart, currentEnd),
      this.getEquipmentMetrics(studioId),
    ]);

    const metrics: DashboardMetrics = {
      revenue,
      bookings,
      clients,
      team,
      equipment,
    };

    // Cache for 1 hour
    await this.cache.set(cacheKey, metrics, 3600);

    return metrics;
  }

  // Get performance metrics
  public async getPerformanceMetrics(
    studioId: string,
    startDate: Date,
    endDate: Date
  ): Promise<PerformanceMetrics> {
    const [
      kpis,
      conversionFunnel,
      servicePerformance,
      seasonalTrends,
    ] = await Promise.all([
      this.calculateKPIs(studioId, startDate, endDate),
      this.getConversionFunnel(studioId, startDate, endDate),
      this.getServicePerformance(studioId, startDate, endDate),
      this.getSeasonalTrends(studioId),
    ]);

    return {
      kpis,
      conversionFunnel,
      servicePerformance,
      seasonalTrends,
    };
  }

  // Get predictive analytics
  public async getPredictiveAnalytics(
    studioId: string
  ): Promise<PredictiveAnalytics> {
    const [
      revenueForeccast,
      demandForecast,
      churnRisk,
      pricingRecommendations,
    ] = await Promise.all([
      this.forecastRevenue(studioId),
      this.forecastDemand(studioId),
      this.identifyChurnRisk(studioId),
      this.recommendPricing(studioId),
    ]);

    return {
      revenueForeccast,
      demandForecast,
      churnRisk,
      pricingRecommendations,
    };
  }

  // Revenue metrics
  private async getRevenueMetrics(
    studioId: string,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date,
    previousEnd: Date
  ) {
    const [current, previous, trend] = await Promise.all([
      // Current period revenue
      this.db.payment.aggregate({
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: currentStart, lte: currentEnd },
        },
        _sum: { amount: true },
      }),
      // Previous period revenue
      this.db.payment.aggregate({
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: previousStart, lte: previousEnd },
        },
        _sum: { amount: true },
      }),
      // Daily trend
      this.db.$queryRaw<any[]>`
        SELECT 
          DATE(p."processedAt") as date,
          SUM(p.amount) as amount
        FROM "Payment" p
        WHERE p."studioId" = ${studioId}
          AND p.status = 'COMPLETED'
          AND p."processedAt" >= ${currentStart}
          AND p."processedAt" <= ${currentEnd}
        GROUP BY DATE(p."processedAt")
        ORDER BY date
      `,
    ]);

    const currentRevenue = Number(current._sum.amount || 0);
    const previousRevenue = Number(previous._sum.amount || 0);
    const growth = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    return {
      current: currentRevenue,
      previous: previousRevenue,
      growth: Math.round(growth * 100) / 100,
      trend: trend.map(item => ({
        date: dayjs(item.date).format('YYYY-MM-DD'),
        amount: Number(item.amount),
      })),
    };
  }

  // Booking metrics
  private async getBookingMetrics(
    studioId: string,
    currentStart: Date,
    currentEnd: Date
  ) {
    const [total, statusCounts, trend] = await Promise.all([
      // Total bookings
      this.db.booking.count({
        where: {
          studioId,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
      }),
      // Bookings by status
      this.db.booking.groupBy({
        by: ['status'],
        where: {
          studioId,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
        _count: true,
      }),
      // Daily trend
      this.db.$queryRaw<any[]>`
        SELECT 
          DATE(b."createdAt") as date,
          COUNT(*) as count
        FROM "Booking" b
        WHERE b."studioId" = ${studioId}
          AND b."createdAt" >= ${currentStart}
          AND b."createdAt" <= ${currentEnd}
        GROUP BY DATE(b."createdAt")
        ORDER BY date
      `,
    ]);

    const statusMap = statusCounts.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    return {
      total,
      completed: statusMap['COMPLETED'] || 0,
      upcoming: (statusMap['CONFIRMED'] || 0) + (statusMap['PENDING'] || 0),
      cancelled: statusMap['CANCELLED'] || 0,
      trend: trend.map(item => ({
        date: dayjs(item.date).format('YYYY-MM-DD'),
        count: Number(item.count),
      })),
    };
  }

  // Client metrics
  private async getClientMetrics(
    studioId: string,
    currentStart: Date,
    currentEnd: Date
  ) {
    const [total, newClients, returningClients, vipClients] = await Promise.all([
      // Total clients
      this.db.client.count({
        where: { studioId, deletedAt: null },
      }),
      // New clients this period
      this.db.client.count({
        where: {
          studioId,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
      }),
      // Returning clients (2+ bookings)
      this.db.client.count({
        where: {
          studioId,
          bookingCount: { gte: 2 },
        },
      }),
      // VIP clients
      this.db.client.count({
        where: {
          studioId,
          isVip: true,
        },
      }),
    ]);

    const retentionRate = total > 0 ? (returningClients / total) * 100 : 0;

    return {
      total,
      new: newClients,
      returning: returningClients,
      vip: vipClients,
      retentionRate: Math.round(retentionRate * 100) / 100,
    };
  }

  // Team metrics
  private async getTeamMetrics(
    studioId: string,
    currentStart: Date,
    currentEnd: Date
  ) {
    const [totalMembers, assignments, performanceData] = await Promise.all([
      // Total team members
      this.db.user.count({
        where: {
          studioId,
          role: { in: ['PHOTOGRAPHER', 'VIDEOGRAPHER', 'ASSISTANT', 'EDITOR'] },
          deletedAt: null,
        },
      }),
      // Assignment data for utilization
      this.db.$queryRaw<any[]>`
        SELECT 
          u.id,
          u."firstName",
          u."lastName",
          COUNT(DISTINCT ba."bookingId") as booking_count,
          SUM(b."totalAmount") as total_revenue
        FROM "User" u
        LEFT JOIN "BookingAssignment" ba ON ba."userId" = u.id
        LEFT JOIN "Booking" b ON b.id = ba."bookingId"
        WHERE u."studioId" = ${studioId}
          AND u.role IN ('PHOTOGRAPHER', 'VIDEOGRAPHER')
          AND u."deletedAt" IS NULL
          AND b."startDateTime" >= ${currentStart}
          AND b."startDateTime" <= ${currentEnd}
        GROUP BY u.id, u."firstName", u."lastName"
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT 5
      `,
      // Average ratings
      this.db.$queryRaw<any[]>`
        SELECT 
          u.id,
          AVG(r.rating) as avg_rating
        FROM "User" u
        JOIN "ProjectAssignment" pa ON pa."userId" = u.id
        JOIN "Review" r ON r."projectId" = pa."projectId"
        WHERE u."studioId" = ${studioId}
        GROUP BY u.id
      `,
    ]);

    // Calculate utilization
    const workDays = this.getWorkDays(currentStart, currentEnd);
    const totalPossibleAssignments = totalMembers * workDays;
    const actualAssignments = assignments.reduce((sum, a) => sum + Number(a.booking_count), 0);
    const utilization = totalPossibleAssignments > 0
      ? (actualAssignments / totalPossibleAssignments) * 100
      : 0;

    // Merge rating data
    const ratingsMap = performanceData.reduce((acc, item) => {
      acc[item.id] = Number(item.avg_rating || 0);
      return acc;
    }, {} as Record<string, number>);

    const topPerformers = assignments.slice(0, 5).map(performer => ({
      user: {
        id: performer.id,
        firstName: performer.firstName,
        lastName: performer.lastName,
      },
      metrics: {
        bookings: Number(performer.booking_count),
        revenue: Number(performer.total_revenue || 0),
        rating: ratingsMap[performer.id] || 0,
      },
    }));

    return {
      totalMembers,
      utilization: Math.round(utilization * 100) / 100,
      topPerformers,
    };
  }

  // Equipment metrics
  private async getEquipmentMetrics(studioId: string) {
    const [
      total,
      statusCounts,
      valueData,
      maintenanceNeeded,
    ] = await Promise.all([
      // Total equipment
      this.db.equipment.count({
        where: { studioId, deletedAt: null },
      }),
      // Equipment by status
      this.db.equipment.groupBy({
        by: ['status'],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      // Total value and depreciation
      this.db.equipment.aggregate({
        where: { studioId, deletedAt: null },
        _sum: {
          purchasePrice: true,
          currentValue: true,
        },
      }),
      // Maintenance needed
      this.db.equipment.count({
        where: {
          studioId,
          deletedAt: null,
          nextMaintenanceDate: { lte: new Date() },
        },
      }),
    ]);

    const statusMap = statusCounts.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const available = statusMap['AVAILABLE'] || 0;
    const inUse = statusMap['IN_USE'] || 0;
    const utilization = total > 0 ? (inUse / total) * 100 : 0;

    const originalValue = Number(valueData._sum.purchasePrice || 0);
    const currentValue = Number(valueData._sum.currentValue || 0);
    const depreciation = originalValue > 0
      ? ((originalValue - currentValue) / originalValue) * 100
      : 0;

    return {
      total,
      available,
      utilization: Math.round(utilization * 100) / 100,
      maintenanceNeeded,
      valueDepreciation: Math.round(depreciation * 100) / 100,
    };
  }

  // Calculate KPIs
  private async calculateKPIs(
    studioId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Get KPI targets from settings
    const kpiSettings = await this.db.systemSetting.findMany({
      where: {
        studioId,
        category: 'kpi_targets',
      },
    });

    const targets = kpiSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value as number;
      return acc;
    }, {} as Record<string, number>);

    // Calculate actual values
    const [
      monthlyRevenue,
      bookingConversion,
      avgBookingValue,
      clientRetention,
      teamUtilization,
    ] = await Promise.all([
      // Monthly revenue
      this.db.payment.aggregate({
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      // Booking conversion rate
      this.getConversionRate(studioId, startDate, endDate),
      // Average booking value
      this.db.booking.aggregate({
        where: {
          studioId,
          status: 'COMPLETED',
          completedAt: { gte: startDate, lte: endDate },
        },
        _avg: { totalAmount: true },
      }),
      // Client retention
      this.getRetentionRate(studioId, startDate, endDate),
      // Team utilization
      this.getTeamUtilizationRate(studioId, startDate, endDate),
    ]);

    const kpis = [
      {
        name: 'Monthly Revenue',
        value: Number(monthlyRevenue._sum.amount || 0),
        target: targets['monthly_revenue'] || 50000,
        achievement: 0,
        trend: 'up' as const,
      },
      {
        name: 'Booking Conversion',
        value: bookingConversion,
        target: targets['booking_conversion'] || 30,
        achievement: 0,
        trend: 'stable' as const,
      },
      {
        name: 'Avg Booking Value',
        value: Number(avgBookingValue._avg.totalAmount || 0),
        target: targets['avg_booking_value'] || 1500,
        achievement: 0,
        trend: 'up' as const,
      },
      {
        name: 'Client Retention',
        value: clientRetention,
        target: targets['client_retention'] || 60,
        achievement: 0,
        trend: 'down' as const,
      },
      {
        name: 'Team Utilization',
        value: teamUtilization,
        target: targets['team_utilization'] || 75,
        achievement: 0,
        trend: 'stable' as const,
      },