import { CampaignStatus } from '@prisma/client';
interface CampaignFilters {
    search?: string;
    status?: CampaignStatus;
    tags?: string[];
    startDate?: Date;
    endDate?: Date;
}
interface AudienceFilter {
    tags?: string[];
    minBookings?: number;
    maxBookings?: number;
    minSpent?: number;
    maxSpent?: number;
    hasMarketingConsent?: boolean;
    lastBookingBefore?: Date;
    lastBookingAfter?: Date;
    createdBefore?: Date;
    createdAfter?: Date;
    isVip?: boolean;
    source?: string;
    location?: {
        city?: string;
        state?: string;
        country?: string;
    };
}
interface EmailTemplate {
    id: string;
    name: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
    category: string;
    variables: string[];
    thumbnail?: string;
}
export declare class EmailMarketingService {
    private static instance;
    private db;
    private emailService;
    private logger;
    private auditService;
    private templateService;
    private analyticsService;
    private constructor();
    static getInstance(): EmailMarketingService;
    private registerHandlebarsHelpers;
    getCampaigns(studioId: string, filters: CampaignFilters, page?: number, limit?: number): Promise<{
        campaigns: any[];
        pagination: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    getCampaignById(campaignId: string, studioId: string): Promise<any>;
    createCampaign(data: {
        name: string;
        subject: string;
        fromName: string;
        fromEmail: string;
        replyTo?: string;
        htmlContent: string;
        textContent?: string;
        audienceFilter?: AudienceFilter;
        testEmails?: string[];
        scheduledFor?: Date;
        tags?: string[];
    }, studioId: string, userId: string): Promise<any>;
    updateCampaign(campaignId: string, studioId: string, data: Partial<{
        name: string;
        subject: string;
        fromName: string;
        fromEmail: string;
        replyTo: string;
        htmlContent: string;
        textContent: string;
        audienceFilter: AudienceFilter;
        testEmails: string[];
        scheduledFor: Date;
        tags: string[];
    }>, userId: string): Promise<any>;
    sendTestEmail(campaignId: string, studioId: string, testEmails: string[], userId: string): Promise<{
        success: boolean;
    }>;
    sendCampaign(campaignId: string, studioId: string, userId: string): Promise<{
        success: boolean;
        sentCount: number;
        failedCount: number;
    }>;
    trackOpen(campaignId: string, clientId: string, userAgent?: string, ip?: string): Promise<void>;
    trackClick(campaignId: string, clientId: string, url: string, userAgent?: string, ip?: string): Promise<string | undefined>;
    handleUnsubscribe(token: string, campaignId?: string): Promise<any>;
    private getCampaignStats;
    private getCampaignPerformance;
    private getAudienceCount;
    private getAudienceClients;
    private buildAudienceWhere;
    private personalizeContent;
    private addTrackingToHtml;
    getEmailTemplates(studioId: string, category?: string): Promise<EmailTemplate[]>;
    createCustomTemplate(data: {
        name: string;
        subject: string;
        htmlContent: string;
        textContent?: string;
        category: string;
    }, studioId: string, userId: string): Promise<any>;
    createAutomation(data: {
        name: string;
        trigger: 'booking_completed' | 'client_birthday' | 'no_booking_30_days' | 'custom';
        conditions?: any;
        campaignId: string;
        delayDays?: number;
    }, studioId: string, userId: string): Promise<any>;
    getCampaignInsights(studioId: string, period?: number): Promise<{
        totalCampaigns: any;
        totalSent: any;
        avgOpenRate: string;
        avgClickRate: string;
        topPerformingCampaigns: any;
        engagementByDay: {
            day: string;
            opens: number;
        }[];
        engagementByHour: any;
    }>;
    private formatDayOfWeekData;
    createABTest(data: {
        name: string;
        variants: Array<{
            name: string;
            subject?: string;
            fromName?: string;
            htmlContent?: string;
            percentage: number;
        }>;
        audienceFilter: AudienceFilter;
        metric: 'open_rate' | 'click_rate';
        duration: number;
    }, studioId: string, userId: string): Promise<{
        testId: any;
        variants: {
            name: string;
            subject?: string;
            fromName?: string;
            htmlContent?: string;
            percentage: number;
        }[];
    }>;
    getSubscriberGrowth(studioId: string, period?: number): Promise<{
        month: string;
        subscribers: number;
        unsubscribes: number;
        netGrowth: number;
    }[]>;
}
export {};
