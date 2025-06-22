interface DashboardMetrics {
    revenue: {
        current: number;
        previous: number;
        growth: number;
        trend: Array<{
            date: string;
            amount: number;
        }>;
    };
    bookings: {
        total: number;
        completed: number;
        upcoming: number;
        cancelled: number;
        trend: Array<{
            date: string;
            count: number;
        }>;
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
        confidence: {
            low: number;
            high: number;
        };
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
export declare class BusinessIntelligenceService {
    private static instance;
    private db;
    private cache;
    private logger;
    private constructor();
    static getInstance(): BusinessIntelligenceService;
    getDashboardMetrics(studioId: string, period?: 'day' | 'week' | 'month' | 'quarter' | 'year'): Promise<DashboardMetrics>;
    getPerformanceMetrics(studioId: string, startDate: Date, endDate: Date): Promise<PerformanceMetrics>;
    getPredictiveAnalytics(studioId: string): Promise<PredictiveAnalytics>;
    private getRevenueMetrics;
    private getBookingMetrics;
    private getClientMetrics;
    private getTeamMetrics;
    private getEquipmentMetrics;
    private calculateKPIs;
}
export {};
