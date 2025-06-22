"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessIntelligenceService = void 0;
const database_service_1 = require("./database.service");
const cache_service_1 = require("./cache.service");
const logger_service_1 = require("./logger.service");
const dayjs_1 = __importDefault(require("dayjs"));
class BusinessIntelligenceService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.cache = cache_service_1.CacheService.getInstance();
    this.logger = logger_service_1.LoggerService.getInstance();
  }
  static getInstance() {
    if (!BusinessIntelligenceService.instance) {
      BusinessIntelligenceService.instance = new BusinessIntelligenceService();
    }
    return BusinessIntelligenceService.instance;
  }
  async getDashboardMetrics(studioId, period = "month") {
    const cacheKey = `dashboard:${studioId}:${period}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const { currentStart, currentEnd, previousStart, previousEnd } =
      this.getPeriodDates(period);
    const [revenue, bookings, clients, team, equipment] = await Promise.all([
      this.getRevenueMetrics(
        studioId,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
      ),
      this.getBookingMetrics(studioId, currentStart, currentEnd),
      this.getClientMetrics(studioId, currentStart, currentEnd),
      this.getTeamMetrics(studioId, currentStart, currentEnd),
      this.getEquipmentMetrics(studioId),
    ]);
    const metrics = {
      revenue,
      bookings,
      clients,
      team,
      equipment,
    };
    await this.cache.set(cacheKey, metrics, 3600);
    return metrics;
  }
  async getPerformanceMetrics(studioId, startDate, endDate) {
    const [kpis, conversionFunnel, servicePerformance, seasonalTrends] =
      await Promise.all([
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
  async getPredictiveAnalytics(studioId) {
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
  async getRevenueMetrics(
    studioId,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  ) {
    const [current, previous, trend] = await Promise.all([
      this.db.payment.aggregate({
        where: {
          studioId,
          status: "COMPLETED",
          processedAt: { gte: currentStart, lte: currentEnd },
        },
        _sum: { amount: true },
      }),
      this.db.payment.aggregate({
        where: {
          studioId,
          status: "COMPLETED",
          processedAt: { gte: previousStart, lte: previousEnd },
        },
        _sum: { amount: true },
      }),
      this.db.$queryRaw`
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
    const growth =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;
    return {
      current: currentRevenue,
      previous: previousRevenue,
      growth: Math.round(growth * 100) / 100,
      trend: trend.map((item) => ({
        date: (0, dayjs_1.default)(item.date).format("YYYY-MM-DD"),
        amount: Number(item.amount),
      })),
    };
  }
  async getBookingMetrics(studioId, currentStart, currentEnd) {
    const [total, statusCounts, trend] = await Promise.all([
      this.db.booking.count({
        where: {
          studioId,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
      }),
      this.db.booking.groupBy({
        by: ["status"],
        where: {
          studioId,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
        _count: true,
      }),
      this.db.$queryRaw`
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
    }, {});
    return {
      total,
      completed: statusMap["COMPLETED"] || 0,
      upcoming: (statusMap["CONFIRMED"] || 0) + (statusMap["PENDING"] || 0),
      cancelled: statusMap["CANCELLED"] || 0,
      trend: trend.map((item) => ({
        date: (0, dayjs_1.default)(item.date).format("YYYY-MM-DD"),
        count: Number(item.count),
      })),
    };
  }
  async getClientMetrics(studioId, currentStart, currentEnd) {
    const [total, newClients, returningClients, vipClients] = await Promise.all(
      [
        this.db.client.count({
          where: { studioId, deletedAt: null },
        }),
        this.db.client.count({
          where: {
            studioId,
            createdAt: { gte: currentStart, lte: currentEnd },
          },
        }),
        this.db.client.count({
          where: {
            studioId,
            bookingCount: { gte: 2 },
          },
        }),
        this.db.client.count({
          where: {
            studioId,
            isVip: true,
          },
        }),
      ],
    );
    const retentionRate = total > 0 ? (returningClients / total) * 100 : 0;
    return {
      total,
      new: newClients,
      returning: returningClients,
      vip: vipClients,
      retentionRate: Math.round(retentionRate * 100) / 100,
    };
  }
  async getTeamMetrics(studioId, currentStart, currentEnd) {
    const [totalMembers, assignments, performanceData] = await Promise.all([
      this.db.user.count({
        where: {
          studioId,
          role: { in: ["PHOTOGRAPHER", "VIDEOGRAPHER", "ASSISTANT", "EDITOR"] },
          deletedAt: null,
        },
      }),
      this.db.$queryRaw`
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
      this.db.$queryRaw`
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
    const workDays = this.getWorkDays(currentStart, currentEnd);
    const totalPossibleAssignments = totalMembers * workDays;
    const actualAssignments = assignments.reduce(
      (sum, a) => sum + Number(a.booking_count),
      0,
    );
    const utilization =
      totalPossibleAssignments > 0
        ? (actualAssignments / totalPossibleAssignments) * 100
        : 0;
    const ratingsMap = performanceData.reduce((acc, item) => {
      acc[item.id] = Number(item.avg_rating || 0);
      return acc;
    }, {});
    const topPerformers = assignments.slice(0, 5).map((performer) => ({
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
  async getEquipmentMetrics(studioId) {
    const [total, statusCounts, valueData, maintenanceNeeded] =
      await Promise.all([
        this.db.equipment.count({
          where: { studioId, deletedAt: null },
        }),
        this.db.equipment.groupBy({
          by: ["status"],
          where: { studioId, deletedAt: null },
          _count: true,
        }),
        this.db.equipment.aggregate({
          where: { studioId, deletedAt: null },
          _sum: {
            purchasePrice: true,
            currentValue: true,
          },
        }),
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
    }, {});
    const available = statusMap["AVAILABLE"] || 0;
    const inUse = statusMap["IN_USE"] || 0;
    const utilization = total > 0 ? (inUse / total) * 100 : 0;
    const originalValue = Number(valueData._sum.purchasePrice || 0);
    const currentValue = Number(valueData._sum.currentValue || 0);
    const depreciation =
      originalValue > 0
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
  async calculateKPIs(studioId, startDate, endDate) {
    const kpiSettings = await this.db.systemSetting.findMany({
      where: {
        studioId,
        category: "kpi_targets",
      },
    });
    const targets = kpiSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    const [
      monthlyRevenue,
      bookingConversion,
      avgBookingValue,
      clientRetention,
      teamUtilization,
    ] = await Promise.all([
      this.db.payment.aggregate({
        where: {
          studioId,
          status: "COMPLETED",
          processedAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      this.getConversionRate(studioId, startDate, endDate),
      this.db.booking.aggregate({
        where: {
          studioId,
          status: "COMPLETED",
          completedAt: { gte: startDate, lte: endDate },
        },
        _avg: { totalAmount: true },
      }),
      this.getRetentionRate(studioId, startDate, endDate),
      this.getTeamUtilizationRate(studioId, startDate, endDate),
    ]);
    const kpis = [
      {
        name: "Monthly Revenue",
        value: Number(monthlyRevenue._sum.amount || 0),
        target: targets["monthly_revenue"] || 50000,
        achievement: 0,
        trend: "up",
      },
      {
        name: "Booking Conversion",
        value: bookingConversion,
        target: targets["booking_conversion"] || 30,
        achievement: 0,
        trend: "stable",
      },
      {
        name: "Avg Booking Value",
        value: Number(avgBookingValue._avg.totalAmount || 0),
        target: targets["avg_booking_value"] || 1500,
        achievement: 0,
        trend: "up",
      },
      {
        name: "Client Retention",
        value: clientRetention,
        target: targets["client_retention"] || 60,
        achievement: 0,
        trend: "down",
      },
      {
        name: "Team Utilization",
        value: teamUtilization,
        target: targets["team_utilization"] || 75,
        achievement: 0,
        trend: "stable",
      },
    ];
  }
}
exports.BusinessIntelligenceService = BusinessIntelligenceService;
