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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientService = void 0;
const database_service_1 = require("./database.service");
const email_service_1 = require("./email.service");
const logger_service_1 = require("./logger.service");
const audit_service_1 = require("./audit.service");
const cache_service_1 = require("./cache.service");
class ClientService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.emailService = email_service_1.EmailService.getInstance();
    this.logger = logger_service_1.LoggerService.getInstance();
    this.auditService = audit_service_1.AuditService.getInstance();
    this.cache = cache_service_1.CacheService.getInstance();
  }
  static getInstance() {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService();
    }
    return ClientService.instance;
  }
  async getClients(
    studioId,
    filters,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  ) {
    const where = {
      studioId,
      deletedAt: null,
    };
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
        { company: { contains: filters.search, mode: "insensitive" } },
        { phone: { contains: filters.search } },
      ];
    }
    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters.minBookings !== undefined) {
      where.bookingCount = { gte: filters.minBookings };
    }
    if (filters.maxBookings !== undefined) {
      where.bookingCount = { ...where.bookingCount, lte: filters.maxBookings };
    }
    if (filters.minSpent !== undefined) {
      where.totalSpent = { gte: filters.minSpent };
    }
    if (filters.maxSpent !== undefined) {
      where.totalSpent = { ...where.totalSpent, lte: filters.maxSpent };
    }
    if (filters.hasMarketingConsent !== undefined) {
      where.marketingConsent = filters.hasMarketingConsent;
    }
    if (filters.isVip !== undefined) {
      where.isVip = filters.isVip;
    }
    if (filters.source) {
      where.source = filters.source;
    }
    if (filters.createdAfter) {
      where.createdAt = { gte: filters.createdAfter };
    }
    if (filters.createdBefore) {
      where.createdAt = { ...where.createdAt, lte: filters.createdBefore };
    }
    if (filters.lastBookingAfter || filters.lastBookingBefore) {
      where.bookings = {
        some: {
          status: { in: ["COMPLETED", "IN_PROGRESS"] },
          startDateTime: {
            gte: filters.lastBookingAfter,
            lte: filters.lastBookingBefore,
          },
        },
      };
    }
    const [clients, total] = await Promise.all([
      this.db.client.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          _count: {
            select: {
              bookings: true,
              projects: true,
              invoices: true,
            },
          },
          bookings: {
            select: {
              id: true,
              startDateTime: true,
              status: true,
              totalAmount: true,
            },
            orderBy: { startDateTime: "desc" },
            take: 1,
          },
        },
      }),
      this.db.client.count({ where }),
    ]);
    return {
      clients,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async getClientById(clientId, studioId) {
    const client = await this.db.client.findFirst({
      where: {
        id: clientId,
        studioId,
        deletedAt: null,
      },
      include: {
        bookings: {
          orderBy: { startDateTime: "desc" },
          take: 10,
          include: {
            assignments: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        projects: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            _count: {
              select: { files: true },
            },
          },
        },
        invoices: {
          orderBy: { issueDate: "desc" },
          take: 5,
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        reviews: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!client) {
      throw new Error("Client not found");
    }
    const stats = await this.getClientStats(clientId);
    return {
      ...client,
      stats,
    };
  }
  async createClient(data, userId) {
    const existing = await this.db.client.findFirst({
      where: {
        studioId: data.studio.connect?.id,
        email: data.email.toLowerCase(),
      },
    });
    if (existing) {
      throw new Error("Client with this email already exists");
    }
    const client = await this.db.client.create({
      data: {
        ...data,
        email: data.email.toLowerCase(),
        unsubscribeToken: this.generateUnsubscribeToken(),
      },
    });
    if (client.marketingConsent) {
      await this.emailService.sendClientWelcomeEmail(
        client.email,
        client.firstName,
      );
    }
    await this.auditService.log({
      studioId: client.studioId,
      userId,
      action: "CLIENT_CREATED",
      entity: "Client",
      entityId: client.id,
      metadata: {
        email: client.email,
        name: `${client.firstName} ${client.lastName}`,
      },
    });
    return client;
  }
  async updateClient(clientId, studioId, data, userId) {
    const client = await this.getClientById(clientId, studioId);
    const oldValues = { ...client };
    const updated = await this.db.client.update({
      where: { id: clientId },
      data: {
        ...data,
        email: data.email ? data.email.toLowerCase() : undefined,
      },
    });
    await database_service_1.DatabaseService.getInstance().updateClientStatistics(
      clientId,
    );
    await this.auditService.log({
      studioId,
      userId,
      action: "CLIENT_UPDATED",
      entity: "Client",
      entityId: clientId,
      oldValues,
      newValues: updated,
    });
    await this.cache.delete(`client:${clientId}`);
    return updated;
  }
  async deleteClient(clientId, studioId, userId) {
    const client = await this.getClientById(clientId, studioId);
    const activeBookings = await this.db.booking.count({
      where: {
        clientId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
    });
    if (activeBookings > 0) {
      throw new Error("Cannot delete client with active bookings");
    }
    await this.db.client.update({
      where: { id: clientId },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "CLIENT_DELETED",
      entity: "Client",
      entityId: clientId,
    });
    return { success: true };
  }
  async getClientStats(clientId) {
    const [bookingStats, paymentStats, projectStats, lastActivity] =
      await Promise.all([
        this.db.booking.aggregate({
          where: {
            clientId,
            status: { in: ["COMPLETED", "IN_PROGRESS"] },
          },
          _count: true,
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
        }),
        this.db.payment.aggregate({
          where: {
            clientId,
            status: "COMPLETED",
          },
          _sum: { amount: true },
        }),
        this.db.project.aggregate({
          where: { clientId },
          _count: true,
        }),
        this.db.booking.findFirst({
          where: { clientId },
          orderBy: { startDateTime: "desc" },
          select: { startDateTime: true },
        }),
      ]);
    return {
      totalBookings: bookingStats._count,
      totalRevenue: Number(bookingStats._sum.totalAmount || 0),
      averageBookingValue: Number(bookingStats._avg.totalAmount || 0),
      totalPaid: Number(paymentStats._sum.amount || 0),
      totalProjects: projectStats._count,
      lastBookingDate: lastActivity?.startDateTime,
    };
  }
  async getClientCommunication(clientId, studioId) {
    const client = await this.getClientById(clientId, studioId);
    const [emailsSent, notifications] = await Promise.all([
      this.db.campaignRecipient.findMany({
        where: { clientId },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              subject: true,
              sentAt: true,
            },
          },
        },
        orderBy: { campaign: { sentAt: "desc" } },
        take: 20,
      }),
      client.portalEnabled
        ? this.db.notification.findMany({
            where: {
              user: {
                email: client.email,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          })
        : [],
    ]);
    return {
      emails: emailsSent,
      notifications,
    };
  }
  async mergeClients(primaryClientId, secondaryClientId, studioId, userId) {
    const [primaryClient, secondaryClient] = await Promise.all([
      this.getClientById(primaryClientId, studioId),
      this.getClientById(secondaryClientId, studioId),
    ]);
    const result = await this.db.$transaction(async (tx) => {
      await Promise.all([
        tx.booking.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.project.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.invoice.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.payment.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.file.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.review.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
        tx.campaignRecipient.updateMany({
          where: { clientId: secondaryClientId },
          data: { clientId: primaryClientId },
        }),
      ]);
      const mergedTags = [
        ...new Set([...primaryClient.tags, ...secondaryClient.tags]),
      ];
      const updated = await tx.client.update({
        where: { id: primaryClientId },
        data: {
          tags: mergedTags,
          notes: primaryClient.notes
            ? `${primaryClient.notes}\n\nMerged from: ${secondaryClient.firstName} ${secondaryClient.lastName} (${secondaryClient.email})\n${secondaryClient.notes || ""}`
            : `Merged from: ${secondaryClient.firstName} ${secondaryClient.lastName} (${secondaryClient.email})`,
          loyaltyPoints: Math.max(
            primaryClient.loyaltyPoints,
            secondaryClient.loyaltyPoints,
          ),
          discountPercentage: Math.max(
            Number(primaryClient.discountPercentage),
            Number(secondaryClient.discountPercentage),
          ),
          isVip: primaryClient.isVip || secondaryClient.isVip,
          marketingConsent:
            primaryClient.marketingConsent || secondaryClient.marketingConsent,
        },
      });
      await tx.client.update({
        where: { id: secondaryClientId },
        data: { deletedAt: new Date() },
      });
      return updated;
    });
    await database_service_1.DatabaseService.getInstance().updateClientStatistics(
      primaryClientId,
    );
    await this.auditService.log({
      studioId,
      userId,
      action: "CLIENTS_MERGED",
      entity: "Client",
      entityId: primaryClientId,
      metadata: {
        primaryClient: primaryClientId,
        secondaryClient: secondaryClientId,
      },
    });
    return result;
  }
  async setupPortalAccess(clientId, studioId, password, userId) {
    const client = await this.getClientById(clientId, studioId);
    if (client.portalEnabled) {
      throw new Error("Portal access already enabled");
    }
    const bcrypt = await Promise.resolve().then(() =>
      __importStar(require("bcryptjs")),
    );
    const hashedPassword = await bcrypt.hash(password, 10);
    const updated = await this.db.client.update({
      where: { id: clientId },
      data: {
        portalEnabled: true,
        portalPassword: hashedPassword,
      },
    });
    await this.db.user.create({
      data: {
        studioId,
        email: client.email,
        password: hashedPassword,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        role: "CLIENT",
        emailVerified: true,
      },
    });
    await this.emailService.sendPortalCredentials(
      client.email,
      client.firstName,
      password,
    );
    await this.auditService.log({
      studioId,
      userId,
      action: "CLIENT_PORTAL_ENABLED",
      entity: "Client",
      entityId: clientId,
    });
    return updated;
  }
  async calculateLoyaltyRewards(clientId, studioId) {
    const client = await this.getClientById(clientId, studioId);
    const loyaltySettings = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: "loyalty_program",
        category: "marketing",
      },
    });
    if (!loyaltySettings) {
      return { points: client.loyaltyPoints, rewards: [] };
    }
    const settings = loyaltySettings.value;
    const pointsPerCurrency = settings.pointsPerCurrency || 1;
    const rewards = settings.rewards || [];
    const availableRewards = rewards.filter(
      (reward) => client.loyaltyPoints >= reward.pointsRequired,
    );
    return {
      points: client.loyaltyPoints,
      nextRewardPoints: rewards.find(
        (r) => r.pointsRequired > client.loyaltyPoints,
      )?.pointsRequired,
      availableRewards,
    };
  }
  async exportClients(studioId, filters, format) {
    const allClients = await this.db.client.findMany({
      where: {
        studioId,
        deletedAt: null,
        ...this.buildWhereClause(filters),
      },
      include: {
        _count: {
          select: {
            bookings: true,
            projects: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (format === "csv") {
      return this.exportToCSV(allClients);
    } else {
      return this.exportToExcel(allClients);
    }
  }
  async getClientInsights(studioId) {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const [
      totalClients,
      activeClients,
      vipClients,
      revenueData,
      clientsBySource,
      monthlyData,
    ] = await Promise.all([
      this.db.client.count({
        where: { studioId, deletedAt: null },
      }),
      this.db.client.count({
        where: {
          studioId,
          deletedAt: null,
          bookings: {
            some: {
              startDateTime: {
                gte: new Date(now.getFullYear(), now.getMonth() - 6, 1),
              },
              status: { in: ["COMPLETED", "IN_PROGRESS"] },
            },
          },
        },
      }),
      this.db.client.count({
        where: { studioId, isVip: true, deletedAt: null },
      }),
      this.db.payment.aggregate({
        where: {
          studio: { id: studioId },
          status: "COMPLETED",
        },
        _sum: { amount: true },
      }),
      this.db.client.groupBy({
        by: ["source"],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      this.db.$queryRaw`
        SELECT 
          DATE_TRUNC('month', c."createdAt") as month,
          COUNT(DISTINCT c.id) as new_clients,
          COALESCE(SUM(p.amount), 0) as revenue
        FROM "Client" c
        LEFT JOIN "Payment" p ON p."clientId" = c.id 
          AND p.status = 'COMPLETED'
          AND DATE_TRUNC('month', p."createdAt") = DATE_TRUNC('month', c."createdAt")
        WHERE c."studioId" = ${studioId}
          AND c."createdAt" >= ${twelveMonthsAgo}
          AND c."deletedAt" IS NULL
        GROUP BY DATE_TRUNC('month', c."createdAt")
        ORDER BY month DESC
      `,
    ]);
    const repeatClients = await this.db.client.count({
      where: {
        studioId,
        deletedAt: null,
        bookingCount: { gte: 2 },
      },
    });
    const repeatClientRate =
      totalClients > 0 ? (repeatClients / totalClients) * 100 : 0;
    const sourceMap = {};
    clientsBySource.forEach((item) => {
      sourceMap[item.source || "Unknown"] = item._count;
    });
    const avgBookingValue = await this.db.booking.aggregate({
      where: {
        studio: { id: studioId },
        status: { in: ["COMPLETED"] },
      },
      _avg: { totalAmount: true },
    });
    return {
      totalClients,
      activeClients,
      vipClients,
      totalRevenue: Number(revenueData._sum.amount || 0),
      averageBookingValue: Number(avgBookingValue._avg.totalAmount || 0),
      repeatClientRate,
      clientsBySource: sourceMap,
      monthlyGrowth: monthlyData.map((row) => ({
        month: row.month.toISOString().slice(0, 7),
        count: Number(row.new_clients),
        revenue: Number(row.revenue),
      })),
    };
  }
  generateUnsubscribeToken() {
    return require("crypto").randomBytes(32).toString("hex");
  }
  buildWhereClause(filters) {
    const where = {};
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
        { company: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters.hasMarketingConsent !== undefined) {
      where.marketingConsent = filters.hasMarketingConsent;
    }
    return where;
  }
  exportToCSV(clients) {
    const headers = [
      "ID",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Company",
      "Total Bookings",
      "Total Spent",
      "Loyalty Points",
      "VIP",
      "Marketing Consent",
      "Tags",
      "Source",
      "Created Date",
    ];
    const rows = clients.map((client) => [
      client.id,
      client.firstName,
      client.lastName,
      client.email,
      client.phone || "",
      client.company || "",
      client._count.bookings,
      client.totalSpent,
      client.loyaltyPoints,
      client.isVip ? "Yes" : "No",
      client.marketingConsent ? "Yes" : "No",
      client.tags.join(", "),
      client.source || "",
      client.createdAt.toISOString(),
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");
    return csvContent;
  }
  async exportToExcel(clients) {
    throw new Error("Excel export not implemented yet");
  }
}
exports.ClientService = ClientService;
