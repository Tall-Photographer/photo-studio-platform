// packages/backend/src/services/client.service.ts
import { Client, Prisma, BookingStatus } from '@prisma/client';
import { DatabaseService } from './database.service';
import { EmailService } from './email.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';
import { CacheService } from './cache.service';

interface ClientFilters {
  search?: string;
  tags?: string[];
  minBookings?: number;
  maxBookings?: number;
  minSpent?: number;
  maxSpent?: number;
  hasMarketingConsent?: boolean;
  isVip?: boolean;
  source?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  lastBookingAfter?: Date;
  lastBookingBefore?: Date;
}

interface ClientStats {
  totalClients: number;
  activeClients: number;
  vipClients: number;
  totalRevenue: number;
  averageBookingValue: number;
  repeatClientRate: number;
  clientsBySource: Record<string, number>;
  monthlyGrowth: Array<{ month: string; count: number; revenue: number }>;
}

export class ClientService {
  private static instance: ClientService;
  private db = DatabaseService.getInstance().getClient();
  private emailService = EmailService.getInstance();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();
  private cache = CacheService.getInstance();

  private constructor() {}

  public static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService();
    }
    return ClientService.instance;
  }

  // Get clients with advanced filtering
  public async getClients(
    studioId: string,
    filters: ClientFilters,
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    const where: Prisma.ClientWhereInput = {
      studioId,
      deletedAt: null,
    };

    // Apply filters
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { company: { contains: filters.search, mode: 'insensitive' } },
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

    // Handle last booking date filters
    if (filters.lastBookingAfter || filters.lastBookingBefore) {
      where.bookings = {
        some: {
          status: { in: ['COMPLETED', 'IN_PROGRESS'] },
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
            orderBy: { startDateTime: 'desc' },
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

  // Get client by ID with full details
  public async getClientById(clientId: string, studioId: string) {
    const client = await this.db.client.findFirst({
      where: {
        id: clientId,
        studioId,
        deletedAt: null,
      },
      include: {
        bookings: {
          orderBy: { startDateTime: 'desc' },
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
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            _count: {
              select: { files: true },
            },
          },
        },
        invoices: {
          orderBy: { issueDate: 'desc' },
          take: 5,
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    // Calculate additional stats
    const stats = await this.getClientStats(clientId);

    return {
      ...client,
      stats,
    };
  }

  // Create new client
  public async createClient(data: Prisma.ClientCreateInput, userId: string) {
    // Check for existing client with same email
    const existing = await this.db.client.findFirst({
      where: {
        studioId: data.studio.connect?.id,
        email: data.email.toLowerCase(),
      },
    });

    if (existing) {
      throw new Error('Client with this email already exists');
    }

    const client = await this.db.client.create({
      data: {
        ...data,
        email: data.email.toLowerCase(),
        unsubscribeToken: this.generateUnsubscribeToken(),
      },
    });

    // Send welcome email if marketing consent given
    if (client.marketingConsent) {
      await this.emailService.sendClientWelcomeEmail(client.email, client.firstName);
    }

    // Audit log
    await this.auditService.log({
      studioId: client.studioId,
      userId,
      action: 'CLIENT_CREATED',
      entity: 'Client',
      entityId: client.id,
      metadata: {
        email: client.email,
        name: `${client.firstName} ${client.lastName}`,
      },
    });

    return client;
  }

  // Update client
  public async updateClient(
    clientId: string,
    studioId: string,
    data: Prisma.ClientUpdateInput,
    userId: string
  ) {
    const client = await this.getClientById(clientId, studioId);

    const oldValues = { ...client };

    const updated = await this.db.client.update({
      where: { id: clientId },
      data: {
        ...data,
        email: data.email ? (data.email as string).toLowerCase() : undefined,
      },
    });

    // Update statistics if needed
    await DatabaseService.getInstance().updateClientStatistics(clientId);

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'CLIENT_UPDATED',
      entity: 'Client',
      entityId: clientId,
      oldValues,
      newValues: updated,
    });

    // Clear cache
    await this.cache.delete(`client:${clientId}`);

    return updated;
  }

  // Delete client (soft delete)
  public async deleteClient(clientId: string, studioId: string, userId: string) {
    const client = await this.getClientById(clientId, studioId);

    // Check if client has active bookings
    const activeBookings = await this.db.booking.count({
      where: {
        clientId,
        status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] },
      },
    });

    if (activeBookings > 0) {
      throw new Error('Cannot delete client with active bookings');
    }

    await this.db.client.update({
      where: { id: clientId },
      data: { deletedAt: new Date() },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'CLIENT_DELETED',
      entity: 'Client',
      entityId: clientId,
    });

    return { success: true };
  }

  // Get client statistics
  private async getClientStats(clientId: string) {
    const [bookingStats, paymentStats, projectStats, lastActivity] = await Promise.all([
      // Booking statistics
      this.db.booking.aggregate({
        where: {
          clientId,
          status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        },
        _count: true,
        _sum: { totalAmount: true },
        _avg: { totalAmount: true },
      }),
      // Payment statistics
      this.db.payment.aggregate({
        where: {
          clientId,
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      }),
      // Project statistics
      this.db.project.aggregate({
        where: { clientId },
        _count: true,
      }),
      // Last activity
      this.db.booking.findFirst({
        where: { clientId },
        orderBy: { startDateTime: 'desc' },
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

  // Get client communication history
  public async getClientCommunication(clientId: string, studioId: string) {
    const client = await this.getClientById(clientId, studioId);

    const [emailsSent, notifications] = await Promise.all([
      // Email campaign recipients
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
        orderBy: { campaign: { sentAt: 'desc' } },
        take: 20,
      }),
      // Notifications (if client has portal access)
      client.portalEnabled
        ? this.db.notification.findMany({
            where: {
              user: {
                email: client.email,
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : [],
    ]);

    return {
      emails: emailsSent,
      notifications,
    };
  }

  // Merge duplicate clients
  public async mergeClients(
    primaryClientId: string,
    secondaryClientId: string,
    studioId: string,
    userId: string
  ) {
    const [primaryClient, secondaryClient] = await Promise.all([
      this.getClientById(primaryClientId, studioId),
      this.getClientById(secondaryClientId, studioId),
    ]);

    // Start transaction
    const result = await this.db.$transaction(async (tx) => {
      // Move all relationships to primary client
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

      // Merge tags
      const mergedTags = [...new Set([...primaryClient.tags, ...secondaryClient.tags])];

      // Update primary client with merged data
      const updated = await tx.client.update({
        where: { id: primaryClientId },
        data: {
          tags: mergedTags,
          notes: primaryClient.notes
            ? `${primaryClient.notes}\n\nMerged from: ${secondaryClient.firstName} ${secondaryClient.lastName} (${secondaryClient.email})\n${secondaryClient.notes || ''}`
            : `Merged from: ${secondaryClient.firstName} ${secondaryClient.lastName} (${secondaryClient.email})`,
          // Keep the highest values
          loyaltyPoints: Math.max(primaryClient.loyaltyPoints, secondaryClient.loyaltyPoints),
          discountPercentage: Math.max(
            Number(primaryClient.discountPercentage),
            Number(secondaryClient.discountPercentage)
          ),
          isVip: primaryClient.isVip || secondaryClient.isVip,
          marketingConsent: primaryClient.marketingConsent || secondaryClient.marketingConsent,
        },
      });

      // Soft delete secondary client
      await tx.client.update({
        where: { id: secondaryClientId },
        data: { deletedAt: new Date() },
      });

      return updated;
    });

    // Update statistics
    await DatabaseService.getInstance().updateClientStatistics(primaryClientId);

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'CLIENTS_MERGED',
      entity: 'Client',
      entityId: primaryClientId,
      metadata: {
        primaryClient: primaryClientId,
        secondaryClient: secondaryClientId,
      },
    });

    return result;
  }

  // Get client portal access
  public async setupPortalAccess(
    clientId: string,
    studioId: string,
    password: string,
    userId: string
  ) {
    const client = await this.getClientById(clientId, studioId);

    if (client.portalEnabled) {
      throw new Error('Portal access already enabled');
    }

    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    const updated = await this.db.client.update({
      where: { id: clientId },
      data: {
        portalEnabled: true,
        portalPassword: hashedPassword,
      },
    });

    // Create user account for portal access
    await this.db.user.create({
      data: {
        studioId,
        email: client.email,
        password: hashedPassword,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        role: 'CLIENT',
        emailVerified: true,
      },
    });

    // Send portal credentials
    await this.emailService.sendPortalCredentials(client.email, client.firstName, password);

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'CLIENT_PORTAL_ENABLED',
      entity: 'Client',
      entityId: clientId,
    });

    return updated;
  }

  // Calculate loyalty rewards
  public async calculateLoyaltyRewards(clientId: string, studioId: string) {
    const client = await this.getClientById(clientId, studioId);

    // Get loyalty settings from studio
    const loyaltySettings = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: 'loyalty_program',
        category: 'marketing',
      },
    });

    if (!loyaltySettings) {
      return { points: client.loyaltyPoints, rewards: [] };
    }

    const settings = loyaltySettings.value as any;
    const pointsPerCurrency = settings.pointsPerCurrency || 1;
    const rewards = settings.rewards || [];

    // Calculate available rewards
    const availableRewards = rewards.filter(
      (reward: any) => client.loyaltyPoints >= reward.pointsRequired
    );

    return {
      points: client.loyaltyPoints,
      nextRewardPoints: rewards.find((r: any) => r.pointsRequired > client.loyaltyPoints)
        ?.pointsRequired,
      availableRewards,
    };
  }

  // Export clients
  public async exportClients(studioId: string, filters: ClientFilters, format: 'csv' | 'excel') {
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
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'csv') {
      return this.exportToCSV(allClients);
    } else {
      return this.exportToExcel(allClients);
    }
  }

  // Get client insights
  public async getClientInsights(studioId: string): Promise<ClientStats> {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [totalClients, activeClients, vipClients, revenueData, clientsBySource, monthlyData] =
      await Promise.all([
        // Total clients
        this.db.client.count({
          where: { studioId, deletedAt: null },
        }),
        // Active clients (booked in last 6 months)
        this.db.client.count({
          where: {
            studioId,
            deletedAt: null,
            bookings: {
              some: {
                startDateTime: {
                  gte: new Date(now.getFullYear(), now.getMonth() - 6, 1),
                },
                status: { in: ['COMPLETED', 'IN_PROGRESS'] },
              },
            },
          },
        }),
        // VIP clients
        this.db.client.count({
          where: { studioId, isVip: true, deletedAt: null },
        }),
        // Total revenue
        this.db.payment.aggregate({
          where: {
            studio: { id: studioId },
            status: 'COMPLETED',
          },
          _sum: { amount: true },
        }),
        // Clients by source
        this.db.client.groupBy({
          by: ['source'],
          where: { studioId, deletedAt: null },
          _count: true,
        }),
        // Monthly growth
        this.db.$queryRaw<any[]>`
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

    // Calculate repeat client rate
    const repeatClients = await this.db.client.count({
      where: {
        studioId,
        deletedAt: null,
        bookingCount: { gte: 2 },
      },
    });

    const repeatClientRate = totalClients > 0 ? (repeatClients / totalClients) * 100 : 0;

    // Format clients by source
    const sourceMap: Record<string, number> = {};
    clientsBySource.forEach((item) => {
      sourceMap[item.source || 'Unknown'] = item._count;
    });

    // Calculate average booking value
    const avgBookingValue = await this.db.booking.aggregate({
      where: {
        studio: { id: studioId },
        status: { in: ['COMPLETED'] },
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

  // Helper methods
  private generateUnsubscribeToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private buildWhereClause(filters: ClientFilters): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = {};

    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { company: { contains: filters.search, mode: 'insensitive' } },
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

  private exportToCSV(clients: any[]): string {
    const headers = [
      'ID',
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Company',
      'Total Bookings',
      'Total Spent',
      'Loyalty Points',
      'VIP',
      'Marketing Consent',
      'Tags',
      'Source',
      'Created Date',
    ];

    const rows = clients.map((client) => [
      client.id,
      client.firstName,
      client.lastName,
      client.email,
      client.phone || '',
      client.company || '',
      client._count.bookings,
      client.totalSpent,
      client.loyaltyPoints,
      client.isVip ? 'Yes' : 'No',
      client.marketingConsent ? 'Yes' : 'No',
      client.tags.join(', '),
      client.source || '',
      client.createdAt.toISOString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  private async exportToExcel(clients: any[]): Promise<Buffer> {
    // This would use a library like exceljs to create Excel files
    // For now, returning a placeholder
    throw new Error('Excel export not implemented yet');
  }
}
