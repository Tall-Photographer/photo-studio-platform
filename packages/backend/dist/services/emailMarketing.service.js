"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailMarketingService = void 0;
const database_service_1 = require("./database.service");
const email_service_1 = require("./email.service");
const logger_service_1 = require("./logger.service");
const audit_service_1 = require("./audit.service");
const template_service_1 = require("./template.service");
const analytics_service_1 = require("./analytics.service");
const Handlebars = __importStar(require("handlebars"));
const dayjs_1 = __importDefault(require("dayjs"));
const uuid_1 = require("uuid");
class EmailMarketingService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.emailService = email_service_1.EmailService.getInstance();
    this.logger = logger_service_1.LoggerService.getInstance();
    this.auditService = audit_service_1.AuditService.getInstance();
    this.templateService = template_service_1.TemplateService.getInstance();
    this.analyticsService = analytics_service_1.AnalyticsService.getInstance();
    this.registerHandlebarsHelpers();
  }
  static getInstance() {
    if (!EmailMarketingService.instance) {
      EmailMarketingService.instance = new EmailMarketingService();
    }
    return EmailMarketingService.instance;
  }
  registerHandlebarsHelpers() {
    Handlebars.registerHelper("formatCurrency", (amount, currency) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
      }).format(amount);
    });
    Handlebars.registerHelper("formatDate", (date, format) => {
      return (0, dayjs_1.default)(date).format(format || "MMM D, YYYY");
    });
    Handlebars.registerHelper("if_eq", function (a, b, options) {
      if (a === b) {
        return options.fn(this);
      }
      return options.inverse(this);
    });
  }
  async getCampaigns(studioId, filters, page = 1, limit = 20) {
    const where = {
      studioId,
    };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { subject: { contains: filters.search, mode: "insensitive" } },
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
        orderBy: { createdAt: "desc" },
      }),
      this.db.emailCampaign.count({ where }),
    ]);
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const stats = await this.getCampaignStats(campaign.id);
        return { ...campaign, stats };
      }),
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
  async getCampaignById(campaignId, studioId) {
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
          orderBy: { sentAt: "desc" },
          take: 100,
        },
      },
    });
    if (!campaign) {
      throw new Error("Campaign not found");
    }
    const stats = await this.getCampaignStats(campaignId);
    const performance = await this.getCampaignPerformance(campaignId);
    return {
      ...campaign,
      stats,
      performance,
    };
  }
  async createCampaign(data, studioId, userId) {
    const studio = await this.db.studio.findUnique({
      where: { id: studioId },
    });
    if (!studio) {
      throw new Error("Studio not found");
    }
    const audienceCount = await this.getAudienceCount(
      studioId,
      data.audienceFilter,
    );
    if (
      audienceCount === 0 &&
      (!data.testEmails || data.testEmails.length === 0)
    ) {
      throw new Error("No recipients found for the selected audience criteria");
    }
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
        status: data.scheduledFor ? "SCHEDULED" : "DRAFT",
        tags: data.tags || [],
        recipientCount: audienceCount,
      },
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "EMAIL_CAMPAIGN_CREATED",
      entity: "EmailCampaign",
      entityId: campaign.id,
      metadata: {
        name: campaign.name,
        recipientCount: audienceCount,
      },
    });
    return campaign;
  }
  async updateCampaign(campaignId, studioId, data, userId) {
    const campaign = await this.getCampaignById(campaignId, studioId);
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      throw new Error("Cannot update campaign that has been sent");
    }
    let recipientCount = campaign.recipientCount;
    if (data.audienceFilter) {
      recipientCount = await this.getAudienceCount(
        studioId,
        data.audienceFilter,
      );
    }
    const updated = await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        ...data,
        recipientCount,
        status: data.scheduledFor ? "SCHEDULED" : campaign.status,
      },
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "EMAIL_CAMPAIGN_UPDATED",
      entity: "EmailCampaign",
      entityId: campaignId,
    });
    return updated;
  }
  async sendTestEmail(campaignId, studioId, testEmails, userId) {
    const campaign = await this.getCampaignById(campaignId, studioId);
    const sampleClient = await this.db.client.findFirst({
      where: { studioId },
      include: {
        bookings: {
          take: 1,
          orderBy: { startDateTime: "desc" },
        },
      },
    });
    for (const email of testEmails) {
      const personalizedContent = await this.personalizeContent(
        campaign.htmlContent,
        sampleClient || {
          firstName: "Test",
          lastName: "User",
          email,
          company: "Test Company",
        },
        campaign,
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
    await this.auditService.log({
      studioId,
      userId,
      action: "EMAIL_CAMPAIGN_TEST_SENT",
      entity: "EmailCampaign",
      entityId: campaignId,
      metadata: {
        recipients: testEmails,
      },
    });
    return { success: true };
  }
  async sendCampaign(campaignId, studioId, userId) {
    const campaign = await this.getCampaignById(campaignId, studioId);
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      throw new Error("Campaign has already been sent");
    }
    await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: "SENDING",
        sentAt: new Date(),
      },
    });
    const recipients = await this.getAudienceClients(
      studioId,
      campaign.audienceFilter,
    );
    const recipientRecords = await this.db.campaignRecipient.createMany({
      data: recipients.map((client) => ({
        campaignId,
        clientId: client.id,
        emailUsed: client.email,
      })),
    });
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
              campaign,
            );
            const trackingId = (0, uuid_1.v4)();
            await this.emailService.sendMarketingEmail({
              to: client.email,
              subject: campaign.subject,
              html: this.addTrackingToHtml(
                personalizedContent.html,
                campaign.id,
                client.id,
                trackingId,
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
            this.logger.error(
              `Failed to send email to ${client.email}:`,
              error,
            );
            failedCount++;
          }
        }),
      );
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          sentCount,
        },
      });
    }
    await this.db.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: "SENT",
        sentCount,
      },
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "EMAIL_CAMPAIGN_SENT",
      entity: "EmailCampaign",
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
  async trackOpen(campaignId, clientId, userAgent, ip) {
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
    if (!recipient.openedAt) {
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          openCount: { increment: 1 },
        },
      });
    }
    await this.analyticsService.trackEmailEvent({
      type: "open",
      campaignId,
      clientId,
      userAgent,
      ip,
      timestamp: new Date(),
    });
  }
  async trackClick(campaignId, clientId, url, userAgent, ip) {
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
    if (!recipient.clickedAt) {
      await this.db.emailCampaign.update({
        where: { id: campaignId },
        data: {
          clickCount: { increment: 1 },
        },
      });
    }
    await this.analyticsService.trackEmailEvent({
      type: "click",
      campaignId,
      clientId,
      url,
      userAgent,
      ip,
      timestamp: new Date(),
    });
    return url;
  }
  async handleUnsubscribe(token, campaignId) {
    const client = await this.db.client.findUnique({
      where: { unsubscribeToken: token },
    });
    if (!client) {
      throw new Error("Invalid unsubscribe token");
    }
    await this.db.client.update({
      where: { id: client.id },
      data: {
        marketingConsent: false,
        marketingConsentDate: new Date(),
      },
    });
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
  async getCampaignStats(campaignId) {
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
    const clickRate =
      delivered > 0 ? (campaign.clickCount / delivered) * 100 : 0;
    const unsubscribeRate =
      delivered > 0 ? (campaign.unsubscribeCount / delivered) * 100 : 0;
    const bounceRate =
      campaign.sentCount > 0
        ? (campaign.bounceCount / campaign.sentCount) * 100
        : 0;
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
  async getCampaignPerformance(campaignId) {
    const analytics =
      await this.analyticsService.getEmailCampaignAnalytics(campaignId);
    return {
      campaignId,
      hourlyStats: analytics.hourlyStats,
      deviceStats: analytics.deviceStats,
      linkPerformance: analytics.linkPerformance,
      geographicData: analytics.geographicData,
    };
  }
  async getAudienceCount(studioId, filter) {
    const where = this.buildAudienceWhere(studioId, filter);
    return this.db.client.count({ where });
  }
  async getAudienceClients(studioId, filter) {
    const where = this.buildAudienceWhere(studioId, filter);
    return this.db.client.findMany({
      where,
      include: {
        bookings: {
          take: 5,
          orderBy: { startDateTime: "desc" },
        },
      },
    });
  }
  buildAudienceWhere(studioId, filter) {
    const where = {
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
  async personalizeContent(htmlContent, client, campaign) {
    const studio = await this.db.studio.findUnique({
      where: { id: campaign.studioId },
    });
    const template = Handlebars.compile(htmlContent);
    const textTemplate = campaign.textContent
      ? Handlebars.compile(campaign.textContent)
      : null;
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
  addTrackingToHtml(html, campaignId, clientId, trackingId) {
    const trackingPixel = `<img src="${process.env.API_URL}/api/v1/email/track/open/${campaignId}/${clientId}/${trackingId}" width="1" height="1" style="display:none;" />`;
    html = html.replace("</body>", `${trackingPixel}</body>`);
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>/gi;
    html = html.replace(linkRegex, (match, url, rest) => {
      if (
        url.startsWith("mailto:") ||
        url.startsWith("tel:") ||
        url.includes("unsubscribe")
      ) {
        return match;
      }
      const trackingUrl = `${process.env.API_URL}/api/v1/email/track/click/${campaignId}/${clientId}/${trackingId}?url=${encodeURIComponent(url)}`;
      return `<a href="${trackingUrl}"${rest}>`;
    });
    return html;
  }
  async getEmailTemplates(studioId, category) {
    const templates = await this.templateService.getEmailTemplates(
      studioId,
      category,
    );
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
  async createCustomTemplate(data, studioId, userId) {
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables = new Set();
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
    await this.auditService.log({
      studioId,
      userId,
      action: "EMAIL_TEMPLATE_CREATED",
      entity: "EmailTemplate",
      entityId: template.id,
      metadata: {
        name: template.name,
        category: template.type,
      },
    });
    return template;
  }
  async createAutomation(data, studioId, userId) {
    const automation = await this.db.systemSetting.create({
      data: {
        studioId,
        key: `automation_${data.name.toLowerCase().replace(/\s+/g, "_")}`,
        category: "email_automation",
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
  async getCampaignInsights(studioId, period = 30) {
    const startDate = (0, dayjs_1.default)().subtract(period, "days").toDate();
    const [
      totalCampaigns,
      totalSent,
      avgOpenRate,
      avgClickRate,
      topPerformingCampaigns,
      engagementByDay,
      engagementByHour,
    ] = await Promise.all([
      this.db.emailCampaign.count({
        where: {
          studioId,
          status: "SENT",
          sentAt: { gte: startDate },
        },
      }),
      this.db.emailCampaign.aggregate({
        where: {
          studioId,
          status: "SENT",
          sentAt: { gte: startDate },
        },
        _sum: { sentCount: true },
      }),
      this.db.$queryRaw`
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
      this.db.$queryRaw`
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
      this.db.emailCampaign.findMany({
        where: {
          studioId,
          status: "SENT",
          sentAt: { gte: startDate },
        },
        orderBy: [
          {
            openCount: "desc",
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
      this.db.$queryRaw`
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
      this.db.$queryRaw`
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
          campaign.sentCount > 0
            ? ((campaign.openCount / campaign.sentCount) * 100).toFixed(2)
            : 0,
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
  formatDayOfWeekData(data) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const result = days.map((day, index) => {
      const found = data.find((d) => Number(d.day_of_week) === index);
      return {
        day,
        opens: found ? Number(found.opens) : 0,
      };
    });
    return result;
  }
  async createABTest(data, studioId, userId) {
    const totalPercentage = data.variants.reduce(
      (sum, v) => sum + v.percentage,
      0,
    );
    if (totalPercentage !== 100) {
      throw new Error("Variant percentages must add up to 100%");
    }
    const baseCampaign = await this.createCampaign(
      {
        name: `${data.name} - A/B Test`,
        subject: data.variants[0].subject || "Test Subject",
        fromName: data.variants[0].fromName || "Studio",
        fromEmail: "noreply@studio.com",
        htmlContent: data.variants[0].htmlContent || "<p>Test</p>",
        audienceFilter: data.audienceFilter,
        tags: ["ab-test"],
      },
      studioId,
      userId,
    );
    await this.db.systemSetting.create({
      data: {
        studioId,
        key: `ab_test_${baseCampaign.id}`,
        category: "ab_testing",
        value: {
          name: data.name,
          baseCampaignId: baseCampaign.id,
          variants: data.variants,
          metric: data.metric,
          duration: data.duration,
          status: "running",
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
  async getSubscriberGrowth(studioId, period = 365) {
    const startDate = (0, dayjs_1.default)().subtract(period, "days").toDate();
    const [subscribers, unsubscribes] = await Promise.all([
      this.db.$queryRaw`
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
      this.db.$queryRaw`
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
    const growthData = {};
    subscribers.forEach((item) => {
      const month = (0, dayjs_1.default)(item.month).format("YYYY-MM");
      growthData[month] = {
        subscribers: Number(item.count),
        unsubscribes: 0,
      };
    });
    unsubscribes.forEach((item) => {
      const month = (0, dayjs_1.default)(item.month).format("YYYY-MM");
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
exports.EmailMarketingService = EmailMarketingService;
