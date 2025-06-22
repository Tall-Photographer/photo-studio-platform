// packages/backend/src/services/emailMarketing.service.ts
import { EmailCampaign, CampaignStatus, Client, Prisma, CampaignRecipient } from '@prisma/client';
import { DatabaseService } from './database.service';
import { EmailService } from './email.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';
import { TemplateService } from './template.service';
import { AnalyticsService } from './analytics.service';
import * as Handlebars from 'handlebars';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface CampaignFilters {
  search?: string;
  status?: CampaignStatus;
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
}

interface CampaignStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  bounceRate: number;
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

interface CampaignPerformance {
  campaignId: string;
  hourlyStats: Array<{
    hour: string;
    opens: number;
    clicks: number;
  }>;
  deviceStats: {
    desktop: number;
    mobile: number;
    tablet: number;
  };
  linkPerformance: Array<{
    url: string;
    clicks: number;
    uniqueClicks: number;
  }>;
  geographicData: Array<{
    country: string;
    opens: number;
    clicks: number;
  }>;
}

export class EmailMarketingService {
  private static instance: EmailMarketingService;
  private db = DatabaseService.getInstance().getClient();
  private emailService = EmailService.getInstance();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();
  private templateService = TemplateService.getInstance();
  private analyticsService = AnalyticsService.getInstance();

  private constructor() {
    this.registerHandlebarsHelpers();
  }

  public static getInstance(): EmailMarketingService {
    if (!EmailMarketingService.instance) {
      EmailMarketingService.instance = new EmailMarketingService();
    }
    return EmailMarketingService.instance;
  }

  // Register Handlebars helpers for email templates
  private registerHandlebarsHelpers() {
    Handlebars.registerHelper('formatCurrency', (amount: number, currency: string) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
      }).format(amount);
    });

    Handlebars.registerHelper('formatDate', (date: Date, format: string) => {
      return dayjs(date).format(format || 'MMM D, YYYY');
    });

    Handlebars.registerHelper('if_eq', function (a: any, b: any, options: any) {
      if (a === b) {
        return options.fn(this);
      }
      return options.inverse(this);
    });
  }

  // Get campaigns
  public async getCampaigns(
    studioId: string,
    filters: CampaignFilters,
    page: number = 1,
    limit: number = 20
  ) {
    const where: Prisma.EmailCampaignWhereInput = {
      studioId,
    };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        gte: filters.startDate,
        lte: filters.endDate,
      };
    }

    const [campaigns, total] = await Promise.all([
      this.db.emailCampaign.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: { recipients: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.emailCampaign.count({ where }),
    ]);

    // Get stats for each campaign
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const stats = await this.getCampaignStats(campaign.id);
        return { ...campaign, stats };
      })
    );

    return {
      campaigns: campaignsWithStats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get campaign by ID
  public async getCampaignById(campaignId: string, studioId: string) {
    const campaign = await this.db.emailCampaign.findFirst({
      where: {
        id: campaignId,
        studioId,
      },
      include: {
        recipients: {
          include: {
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
          orderBy: { sentAt: 'desc' },
          take: 100,
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const stats = await this.getCampaignStats(campaignId);
    const performance = await this.getCampaignPerformance(campaignId);

    return {
      ...campaign,
      stats,
      performance,
    };
  }

  // Create campaign
  public async createCampaign(
    data: {
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
    },
    studioId: string,
    userId: string
  ) {
    // Validate from email
    const studio = await this.db.studio.findUnique({
      where: { id: studioId },
    });

    if (!studio) {
      throw new Error('Studio not found');
    }

    // Get audience count
    const audienceCount = await this.getAudienceCount(studioId, data.audienceFilter);

    if (audienceCount === 0 && (!data.testEmails || data.testEmails.length === 0)) {
      throw new Error('No recipients found for the selected audience criteria');
    }

    // Create campaign
    const campaign = await this.db.emailCampaign.create({
      data: {
        studioId,
        name: data.name,
        subject: data.subject,
        fromName: data.fromName,
        fromEmail: data.fromEmail,
        replyTo: data.replyTo || data.fromEmail,
        htmlContent: data.htmlContent,
        textContent: data.textContent,
        audienceFilter: data.audienceFilter || {},
        testEmails: data.testEmails || [],
        scheduledFor: data.scheduledFor,
        status: data.scheduledFor ? 'SCHEDULED' : 'DRAFT',
        tags: data.tags || [],
        recipientCount: audienceCount,
      },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EMAIL_CAMPAIGN_CREATED',
      entity: 'EmailCampaign',
      entityId: campaign.id,
      metadata: {
        name: campaign.name,
        recipientCount: audienceCount,
      },
    });

    return campaign;
  }

  // Update campaign
  public async updateCampaign(
    campaignId: string,
    studioId: string,
    data: Partial<{
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
    }>,
    userId: string
  ) {
    const campaign = await this.getCampaignById(campaignId, studioId);

    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new Error('Cannot update campaign that has been sent');
    }

    // Recalculate audience if filter changed
    let recipientCount = campaign.recipientCount;
    if (data.audienceFilter) {
      recipientCount = await this.getAudienceCount(studioId, data.audienceFilter);
    }

    const updated = await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        ...data,
        recipientCount,
        status: data.scheduledFor ? 'SCHEDULED' : campaign.status,
      },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EMAIL_CAMPAIGN_UPDATED',
      entity: 'EmailCampaign',
      entityId: campaignId,
    });

    return updated;
  }

  // Send test email
  public async sendTestEmail(
    campaignId: string,
    studioId: string,
    testEmails: string[],
    userId: string
  ) {
    const campaign = await this.getCampaignById(campaignId, studioId);

    // Get a sample client for personalization
    const sampleClient = await this.db.client.findFirst({
      where: { studioId },
      include: {
        bookings: {
          take: 1,
          orderBy: { startDateTime: 'desc' },
        },
      },
    });

    for (const email of testEmails) {
      const personalizedContent = await this.personalizeContent(
        campaign.htmlContent,
        sampleClient || {
          firstName: 'Test',
          lastName: 'User',
          email,
          company: 'Test Company',
        },
        campaign
      );

      await this.emailService.sendMarketingEmail({
        to: email,
        subject: `[TEST] ${campaign.subject}`,
        html: personalizedContent.html,
        text: personalizedContent.text,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        replyTo: campaign.replyTo,
        campaignId: campaign.id,
        isTest: true,
      });
    }

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EMAIL_CAMPAIGN_TEST_SENT',
      entity: 'EmailCampaign',
      entityId: campaignId,
      metadata: {
        recipients: testEmails,
      },
    });

    return { success: true };
  }

  // Send campaign
  public async sendCampaign(campaignId: string, studioId: string, userId: string) {
    const campaign = await this.getCampaignById(campaignId, studioId);

    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new Error('Campaign has already been sent');
    }

    // Update status
    await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'SENDING',
        sentAt: new Date(),
      },
    });

    // Get recipients
    const recipients = await this.getAudienceClients(
      studioId,
      campaign.audienceFilter as AudienceFilter
    );

    // Create recipient records
    const recipientRecords = await this.db.campaignRecipient.createMany({
      data: recipients.map((client) => ({
        campaignId,
        clientId: client.id,
        emailUsed: client.email,
      })),
    });

    // Send emails in batches
    const batchSize = 50;
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (client) => {
          try {
            const personalizedContent = await this.personalizeContent(
              campaign.htmlContent,
              client,
              campaign
            );

            const trackingId = uuidv4();

            await this.emailService.sendMarketingEmail({
              to: client.email,
              subject: campaign.subject,
              html: this.addTrackingToHtml(
                personalizedContent.html,
                campaign.id,
                client.id,
                trackingId
              ),
              text: personalizedContent.text,
              fromName: campaign.fromName,
              fromEmail: campaign.fromEmail,
              replyTo: campaign.replyTo,
              campaignId: campaign.id,
              clientId: client.id,
              trackingId,
              unsubscribeToken: client.unsubscribeToken,
            });

            await this.db.campaignRecipient.update({
              where: {
                campaignId_clientId: {
                  campaignId,
                  clientId: client.id,
                },
              },
              data: {
                sentAt: new Date(),
              },
            });

            sentCount++;
          } catch (error) {
            this.logger.error(`Failed to send email to ${client.email}:`, error);
            failedCount++;
          }
        })
      );

      // Update progress
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          sentCount,
        },
      });
    }

    // Update final status
    await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'SENT',
        sentCount,
      },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EMAIL_CAMPAIGN_SENT',
      entity: 'EmailCampaign',
      entityId: campaignId,
      metadata: {
        sentCount,
        failedCount,
      },
    });

    return {
      success: true,
      sentCount,
      failedCount,
    };
  }

  // Track email open
  public async trackOpen(campaignId: string, clientId: string, userAgent?: string, ip?: string) {
    const recipient = await this.db.campaignRecipient.findUnique({
      where: {
        campaignId_clientId: {
          campaignId,
          clientId,
        },
      },
    });

    if (!recipient) {
      return;
    }

    // Update recipient
    await this.db.campaignRecipient.update({
      where: {
        campaignId_clientId: {
          campaignId,
          clientId,
        },
      },
      data: {
        openedAt: recipient.openedAt || new Date(),
        openCount: { increment: 1 },
      },
    });

    // Update campaign stats
    if (!recipient.openedAt) {
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          openCount: { increment: 1 },
        },
      });
    }

    // Track analytics
    await this.analyticsService.trackEmailEvent({
      type: 'open',
      campaignId,
      clientId,
      userAgent,
      ip,
      timestamp: new Date(),
    });
  }

  // Track email click
  public async trackClick(
    campaignId: string,
    clientId: string,
    url: string,
    userAgent?: string,
    ip?: string
  ) {
    const recipient = await this.db.campaignRecipient.findUnique({
      where: {
        campaignId_clientId: {
          campaignId,
          clientId,
        },
      },
    });

    if (!recipient) {
      return;
    }

    // Update recipient
    await this.db.campaignRecipient.update({
      where: {
        campaignId_clientId: {
          campaignId,
          clientId,
        },
      },
      data: {
        clickedAt: recipient.clickedAt || new Date(),
        clickCount: { increment: 1 },
      },
    });

    // Update campaign stats
    if (!recipient.clickedAt) {
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          clickCount: { increment: 1 },
        },
      });
    }

    // Track analytics
    await this.analyticsService.trackEmailEvent({
      type: 'click',
      campaignId,
      clientId,
      url,
      userAgent,
      ip,
      timestamp: new Date(),
    });

    return url;
  }

  // Handle unsubscribe
  public async handleUnsubscribe(token: string, campaignId?: string) {
    const client = await this.db.client.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!client) {
      throw new Error('Invalid unsubscribe token');
    }

    // Update client
    await this.db.client.update({
      where: { id: client.id },
      data: {
        marketingConsent: false,
        marketingConsentDate: new Date(),
      },
    });

    // Update campaign stats if from campaign
    if (campaignId) {
      const recipient = await this.db.campaignRecipient.findUnique({
        where: {
          campaignId_clientId: {
            campaignId,
            clientId: client.id,
          },
        },
      });

      if (recipient && !recipient.unsubscribedAt) {
        await this.db.campaignRecipient.update({
          where: {
            campaignId_clientId: {
              campaignId,
              clientId: client.id,
            },
          },
          data: {
            unsubscribedAt: new Date(),
          },
        });

        await this.db.emailCampaign.update({
          where: { id: campaignId },
          data: {
            unsubscribeCount: { increment: 1 },
          },
        });
      }
    }

    return client;
  }

  // Get campaign stats
  private async getCampaignStats(campaignId: string): Promise<CampaignStats> {
    const campaign = await this.db.emailCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        bounced: 0,
        openRate: 0,
        clickRate: 0,
        unsubscribeRate: 0,
        bounceRate: 0,
      };
    }

    const delivered = campaign.sentCount - campaign.bounceCount;
    const openRate = delivered > 0 ? (campaign.openCount / delivered) * 100 : 0;
    const clickRate = delivered > 0 ? (campaign.clickCount / delivered) * 100 : 0;
    const unsubscribeRate = delivered > 0 ? (campaign.unsubscribeCount / delivered) * 100 : 0;
    const bounceRate =
      campaign.sentCount > 0 ? (campaign.bounceCount / campaign.sentCount) * 100 : 0;

    return {
      sent: campaign.sentCount,
      delivered,
      opened: campaign.openCount,
      clicked: campaign.clickCount,
      unsubscribed: campaign.unsubscribeCount,
      bounced: campaign.bounceCount,
      openRate: Math.round(openRate * 100) / 100,
      clickRate: Math.round(clickRate * 100) / 100,
      unsubscribeRate: Math.round(unsubscribeRate * 100) / 100,
      bounceRate: Math.round(bounceRate * 100) / 100,
    };
  }

  // Get campaign performance
  private async getCampaignPerformance(campaignId: string): Promise<CampaignPerformance> {
    const analytics = await this.analyticsService.getEmailCampaignAnalytics(campaignId);

    return {
      campaignId,
      hourlyStats: analytics.hourlyStats,
      deviceStats: analytics.deviceStats,
      linkPerformance: analytics.linkPerformance,
      geographicData: analytics.geographicData,
    };
  }

  // Get audience count
  private async getAudienceCount(studioId: string, filter?: AudienceFilter): Promise<number> {
    const where = this.buildAudienceWhere(studioId, filter);
    return this.db.client.count({ where });
  }

  // Get audience clients
  private async getAudienceClients(studioId: string, filter?: AudienceFilter): Promise<Client[]> {
    const where = this.buildAudienceWhere(studioId, filter);

    return this.db.client.findMany({
      where,
      include: {
        bookings: {
          take: 5,
          orderBy: { startDateTime: 'desc' },
        },
      },
    });
  }

  // Build audience where clause
  private buildAudienceWhere(studioId: string, filter?: AudienceFilter): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = {
      studioId,
      deletedAt: null,
      marketingConsent: true,
    };

    if (!filter) {
      return where;
    }

    if (filter.tags?.length) {
      where.tags = { hasSome: filter.tags };
    }

    if (filter.minBookings !== undefined) {
      where.bookingCount = { gte: filter.minBookings };
    }

    if (filter.maxBookings !== undefined) {
      where.bookingCount = { ...where.bookingCount, lte: filter.maxBookings };
    }

    if (filter.minSpent !== undefined) {
      where.totalSpent = { gte: filter.minSpent };
    }

    if (filter.maxSpent !== undefined) {
      where.totalSpent = { ...where.totalSpent, lte: filter.maxSpent };
    }

    if (filter.isVip !== undefined) {
      where.isVip = filter.isVip;
    }

    if (filter.source) {
      where.source = filter.source;
    }

    if (filter.createdAfter || filter.createdBefore) {
      where.createdAt = {
        gte: filter.createdAfter,
        lte: filter.createdBefore,
      };
    }

    if (filter.lastBookingAfter || filter.lastBookingBefore) {
      where.bookings = {
        some: {
          startDateTime: {
            gte: filter.lastBookingAfter,
            lte: filter.lastBookingBefore,
          },
        },
      };
    }

    if (filter.location) {
      if (filter.location.city) {
        where.city = filter.location.city;
      }
      if (filter.location.state) {
        where.state = filter.location.state;
      }
      if (filter.location.country) {
        where.country = filter.location.country;
      }
    }

    return where;
  }

  // Personalize content
  private async personalizeContent(htmlContent: string, client: any, campaign: EmailCampaign) {
    const studio = await this.db.studio.findUnique({
      where: { id: campaign.studioId },
    });

    const template = Handlebars.compile(htmlContent);
    const textTemplate = campaign.textContent ? Handlebars.compile(campaign.textContent) : null;

    const data = {
      client: {
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        company: client.company,
        loyaltyPoints: client.loyaltyPoints,
        isVip: client.isVip,
      },
      studio: {
        name: studio?.name,
        email: studio?.email,
        phone: studio?.phone,
        website: studio?.website,
        logo: studio?.logo,
      },
      campaign: {
        subject: campaign.subject,
        fromName: campaign.fromName,
      },
      currentYear: new Date().getFullYear(),
      unsubscribeUrl: `${process.env.APP_URL}/unsubscribe/${client.unsubscribeToken}`,
    };

    return {
      html: template(data),
      text: textTemplate ? textTemplate(data) : undefined,
    };
  }

  // Add tracking to HTML
  private addTrackingToHtml(
    html: string,
    campaignId: string,
    clientId: string,
    trackingId: string
  ): string {
    // Add open tracking pixel
    const trackingPixel = `<img src="${process.env.API_URL}/api/v1/email/track/open/${campaignId}/${clientId}/${trackingId}" width="1" height="1" style="display:none;" />`;
    html = html.replace('</body>', `${trackingPixel}</body>`);

    // Replace links with tracking links
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>/gi;
    html = html.replace(linkRegex, (match, url, rest) => {
      if (url.startsWith('mailto:') || url.startsWith('tel:') || url.includes('unsubscribe')) {
        return match;
      }
      const trackingUrl = `${process.env.API_URL}/api/v1/email/track/click/${campaignId}/${clientId}/${trackingId}?url=${encodeURIComponent(url)}`;
      return `<a href="${trackingUrl}"${rest}>`;
    });

    return html;
  }

  // Get email templates
  public async getEmailTemplates(studioId: string, category?: string): Promise<EmailTemplate[]> {
    const templates = await this.templateService.getEmailTemplates(studioId, category);

    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent,
      category: template.type,
      variables: template.availableVariables,
      thumbnail: template.thumbnail,
    }));
  }

  // Create custom template
  public async createCustomTemplate(
    data: {
      name: string;
      subject: string;
      htmlContent: string;
      textContent?: string;
      category: string;
    },
    studioId: string,
    userId: string
  ) {
    // Extract variables from template
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variableRegex.exec(data.htmlContent)) !== null) {
      variables.add(match[1].trim());
    }

    const template = await this.db.emailTemplate.create({
      data: {
        studioId,
        name: data.name,
        subject: data.subject,
        type: data.category,
        htmlContent: data.htmlContent,
        textContent: data.textContent,
        availableVariables: Array.from(variables),
        isActive: true,
      },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EMAIL_TEMPLATE_CREATED',
      entity: 'EmailTemplate',
      entityId: template.id,
      metadata: {
        name: template.name,
        category: template.type,
      },
    });

    return template;
  }

  // Campaign automation
  public async createAutomation(
    data: {
      name: string;
      trigger: 'booking_completed' | 'client_birthday' | 'no_booking_30_days' | 'custom';
      conditions?: any;
      campaignId: string;
      delayDays?: number;
    },
    studioId: string,
    userId: string
  ) {
    // This would create automated email campaigns based on triggers
    // Implementation would include:
    // - Setting up triggers for various events
    // - Scheduling automated sends
    // - Managing automation workflows

    const automation = await this.db.systemSetting.create({
      data: {
        studioId,
        key: `automation_${data.name.toLowerCase().replace(/\s+/g, '_')}`,
        category: 'email_automation',
        value: {
          name: data.name,
          trigger: data.trigger,
          conditions: data.conditions,
          campaignId: data.campaignId,
          delayDays: data.delayDays || 0,
          isActive: true,
          createdBy: userId,
          createdAt: new Date(),
        },
        description: `Email automation: ${data.name}`,
        isPublic: false,
      },
    });

    return automation;
  }

  // Get campaign insights
  public async getCampaignInsights(studioId: string, period: number = 30) {
    const startDate = dayjs().subtract(period, 'days').toDate();

    const [
      totalCampaigns,
      totalSent,
      avgOpenRate,
      avgClickRate,
      topPerformingCampaigns,
      engagementByDay,
      engagementByHour,
    ] = await Promise.all([
      // Total campaigns
      this.db.emailCampaign.count({
        where: {
          studioId,
          status: 'SENT',
          sentAt: { gte: startDate },
        },
      }),
      // Total emails sent
      this.db.emailCampaign.aggregate({
        where: {
          studioId,
          status: 'SENT',
          sentAt: { gte: startDate },
        },
        _sum: { sentCount: true },
      }),
      // Average open rate
      this.db.$queryRaw<any[]>`
        SELECT AVG(
          CASE 
            WHEN "sentCount" > 0 
            THEN ("openCount"::float / "sentCount") * 100 
            ELSE 0 
          END
        ) as avg_open_rate
        FROM "EmailCampaign"
        WHERE "studioId" = ${studioId}
          AND status = 'SENT'
          AND "sentAt" >= ${startDate}
      `,
      // Average click rate
      this.db.$queryRaw<any[]>`
        SELECT AVG(
          CASE 
            WHEN "sentCount" > 0 
            THEN ("clickCount"::float / "sentCount") * 100 
            ELSE 0 
          END
        ) as avg_click_rate
        FROM "EmailCampaign"
        WHERE "studioId" = ${studioId}
          AND status = 'SENT'
          AND "sentAt" >= ${startDate}
      `,
      // Top performing campaigns
      this.db.emailCampaign.findMany({
        where: {
          studioId,
          status: 'SENT',
          sentAt: { gte: startDate },
        },
        orderBy: [
          {
            openCount: 'desc',
          },
        ],
        take: 5,
        select: {
          id: true,
          name: true,
          subject: true,
          sentAt: true,
          sentCount: true,
          openCount: true,
          clickCount: true,
        },
      }),
      // Engagement by day of week
      this.db.$queryRaw<any[]>`
        SELECT 
          EXTRACT(DOW FROM cr."openedAt") as day_of_week,
          COUNT(*) as opens
        FROM "CampaignRecipient" cr
        JOIN "EmailCampaign" ec ON ec.id = cr."campaignId"
        WHERE ec."studioId" = ${studioId}
          AND cr."openedAt" IS NOT NULL
          AND cr."openedAt" >= ${startDate}
        GROUP BY EXTRACT(DOW FROM cr."openedAt")
        ORDER BY day_of_week
      `,
      // Engagement by hour
      this.db.$queryRaw<any[]>`
        SELECT 
          EXTRACT(HOUR FROM cr."openedAt") as hour,
          COUNT(*) as opens
        FROM "CampaignRecipient" cr
        JOIN "EmailCampaign" ec ON ec.id = cr."campaignId"
        WHERE ec."studioId" = ${studioId}
          AND cr."openedAt" IS NOT NULL
          AND cr."openedAt" >= ${startDate}
        GROUP BY EXTRACT(HOUR FROM cr."openedAt")
        ORDER BY hour
      `,
    ]);

    return {
      totalCampaigns,
      totalSent: totalSent._sum.sentCount || 0,
      avgOpenRate: Number(avgOpenRate[0]?.avg_open_rate || 0).toFixed(2),
      avgClickRate: Number(avgClickRate[0]?.avg_click_rate || 0).toFixed(2),
      topPerformingCampaigns: topPerformingCampaigns.map((campaign) => ({
        ...campaign,
        openRate:
          campaign.sentCount > 0 ? ((campaign.openCount / campaign.sentCount) * 100).toFixed(2) : 0,
        clickRate:
          campaign.sentCount > 0
            ? ((campaign.clickCount / campaign.sentCount) * 100).toFixed(2)
            : 0,
      })),
      engagementByDay: this.formatDayOfWeekData(engagementByDay),
      engagementByHour: engagementByHour.map((item) => ({
        hour: Number(item.hour),
        opens: Number(item.opens),
      })),
    };
  }

  // Format day of week data
  private formatDayOfWeekData(data: any[]) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const result = days.map((day, index) => {
      const found = data.find((d) => Number(d.day_of_week) === index);
      return {
        day,
        opens: found ? Number(found.opens) : 0,
      };
    });
    return result;
  }

  // A/B Testing
  public async createABTest(
    data: {
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
      duration: number; // hours
    },
    studioId: string,
    userId: string
  ) {
    // Validate percentages add up to 100
    const totalPercentage = data.variants.reduce((sum, v) => sum + v.percentage, 0);
    if (totalPercentage !== 100) {
      throw new Error('Variant percentages must add up to 100%');
    }

    // Create base campaign
    const baseCampaign = await this.createCampaign(
      {
        name: `${data.name} - A/B Test`,
        subject: data.variants[0].subject || 'Test Subject',
        fromName: data.variants[0].fromName || 'Studio',
        fromEmail: 'noreply@studio.com',
        htmlContent: data.variants[0].htmlContent || '<p>Test</p>',
        audienceFilter: data.audienceFilter,
        tags: ['ab-test'],
      },
      studioId,
      userId
    );

    // Store A/B test configuration
    await this.db.systemSetting.create({
      data: {
        studioId,
        key: `ab_test_${baseCampaign.id}`,
        category: 'ab_testing',
        value: {
          name: data.name,
          baseCampaignId: baseCampaign.id,
          variants: data.variants,
          metric: data.metric,
          duration: data.duration,
          status: 'running',
          startedAt: new Date(),
        },
        description: `A/B Test: ${data.name}`,
      },
    });

    return {
      testId: baseCampaign.id,
      variants: data.variants,
    };
  }

  // Get subscriber growth
  public async getSubscriberGrowth(studioId: string, period: number = 365) {
    const startDate = dayjs().subtract(period, 'days').toDate();

    const [subscribers, unsubscribes] = await Promise.all([
      // New subscribers by month
      this.db.$queryRaw<any[]>`
        SELECT 
          DATE_TRUNC('month', "createdAt") as month,
          COUNT(*) as count
        FROM "Client"
        WHERE "studioId" = ${studioId}
          AND "marketingConsent" = true
          AND "createdAt" >= ${startDate}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY month
      `,
      // Unsubscribes by month
      this.db.$queryRaw<any[]>`
        SELECT 
          DATE_TRUNC('month', cr."unsubscribedAt") as month,
          COUNT(*) as count
        FROM "CampaignRecipient" cr
        JOIN "EmailCampaign" ec ON ec.id = cr."campaignId"
        WHERE ec."studioId" = ${studioId}
          AND cr."unsubscribedAt" IS NOT NULL
          AND cr."unsubscribedAt" >= ${startDate}
        GROUP BY DATE_TRUNC('month', cr."unsubscribedAt")
        ORDER BY month
      `,
    ]);

    // Combine data
    const growthData: Record<string, { subscribers: number; unsubscribes: number }> = {};

    subscribers.forEach((item) => {
      const month = dayjs(item.month).format('YYYY-MM');
      growthData[month] = {
        subscribers: Number(item.count),
        unsubscribes: 0,
      };
    });

    unsubscribes.forEach((item) => {
      const month = dayjs(item.month).format('YYYY-MM');
      if (growthData[month]) {
        growthData[month].unsubscribes = Number(item.count);
      } else {
        growthData[month] = {
          subscribers: 0,
          unsubscribes: Number(item.count),
        };
      }
    });

    return Object.entries(growthData)
      .map(([month, data]) => ({
        month,
        subscribers: data.subscribers,
        unsubscribes: data.unsubscribes,
        netGrowth: data.subscribers - data.unsubscribes,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
}
