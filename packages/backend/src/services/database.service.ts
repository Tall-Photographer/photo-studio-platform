// packages/backend/src/services/database.service.ts
import { PrismaClient } from '@prisma/client';
import { LoggerService } from './logger.service';

export class DatabaseService {
  private static instance: DatabaseService;
  private prisma: PrismaClient;
  private logger = LoggerService.getInstance();
  private isConnectedFlag = false;

  private constructor() {
    this.prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
    });

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      this.prisma.$on('query', (e: any) => {
        this.logger.debug('Query:', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      });
    }

    // Log errors
    this.prisma.$on('error', (e: any) => {
      this.logger.error('Database error:', e);
    });

    // Log warnings
    this.prisma.$on('warn', (e: any) => {
      this.logger.warn('Database warning:', e);
    });

    // Set up middleware for soft deletes
    this.setupMiddleware();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private setupMiddleware(): void {
    // Soft delete middleware for models with deletedAt
    const modelsWithSoftDelete = [
      'Studio',
      'User',
      'Client',
      'Equipment',
      'Room',
    ];

    // Auto-update booking numbers
    this.prisma.$use(async (params, next) => {
      if (params.model === 'Booking' && params.action === 'create') {
        const studio = await this.prisma.studio.findUnique({
          where: { id: params.args.data.studioId },
        });

        if (studio) {
          const count = await this.prisma.booking.count({
            where: { studioId: studio.id },
          });

          const year = new Date().getFullYear();
          const bookingNumber = `${studio.slug.toUpperCase()}-${year}-${String(count + 1).padStart(5, '0')}`;
          params.args.data.bookingNumber = bookingNumber;
        }
      }

      // Auto-update invoice numbers
      if (params.model === 'Invoice' && params.action === 'create') {
        const studio = await this.prisma.studio.findUnique({
          where: { id: params.args.data.studioId },
        });

        if (studio) {
          const count = await this.prisma.invoice.count({
            where: { studioId: studio.id },
          });

          const year = new Date().getFullYear();
          const invoiceNumber = `INV-${studio.slug.toUpperCase()}-${year}-${String(count + 1).padStart(5, '0')}`;
          params.args.data.invoiceNumber = invoiceNumber;
        }
      }

      // Auto-update payment numbers
      if (params.model === 'Payment' && params.action === 'create') {
        const studio = await this.prisma.studio.findUnique({
          where: { id: params.args.data.studioId },
        });

        if (studio) {
          const count = await this.prisma.payment.count({
            where: { studioId: studio.id },
          });

          const year = new Date().getFullYear();
          const paymentNumber = `PAY-${studio.slug.toUpperCase()}-${year}-${String(count + 1).padStart(5, '0')}`;
          params.args.data.paymentNumber = paymentNumber;
        }
      }

      // Auto-update project numbers
      if (params.model === 'Project' && params.action === 'create') {
        const studio = await this.prisma.studio.findUnique({
          where: { id: params.args.data.studioId },
        });

        if (studio) {
          const count = await this.prisma.project.count({
            where: { studioId: studio.id },
          });

          const year = new Date().getFullYear();
          const projectNumber = `PRJ-${studio.slug.toUpperCase()}-${year}-${String(count + 1).padStart(4, '0')}`;
          params.args.data.projectNumber = projectNumber;
        }
      }

      // Soft delete handling
      if (modelsWithSoftDelete.includes(params.model || '')) {
        if (params.action === 'delete') {
          params.action = 'update';
          params.args.data = { deletedAt: new Date() };
        }

        if (params.action === 'deleteMany') {
          params.action = 'updateMany';
          if (params.args.data !== undefined) {
            params.args.data = { deletedAt: new Date() };
          } else {
            params.args.data = { deletedAt: new Date() };
          }
        }

        // Exclude soft deleted records from queries
        if (params.action === 'findFirst' || params.action === 'findMany') {
          if (params.args.where !== undefined) {
            if (params.args.where.deletedAt === undefined) {
              params.args.where.deletedAt = null;
            }
          } else {
            params.args.where = { deletedAt: null };
          }
        }
      }

      // Calculate invoice totals
      if (params.model === 'Invoice' && (params.action === 'create' || params.action === 'update')) {
        if (params.args.data.lineItems?.create || params.args.data.lineItems?.update) {
          // This will be calculated after line items are saved
          const result = await next(params);
          
          // Recalculate totals
          await this.recalculateInvoiceTotals(result.id);
          
          return result;
        }
      }

      return next(params);
    });
  }

  private async recalculateInvoiceTotals(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true },
    });

    if (!invoice) return;

    const subtotal = invoice.lineItems.reduce((sum, item) => {
      return sum + Number(item.total);
    }, 0);

    const discountAmount = invoice.discountPercentage
      ? (subtotal * Number(invoice.discountPercentage)) / 100
      : Number(invoice.discountAmount);

    const taxableAmount = subtotal - discountAmount;
    const taxAmount = (taxableAmount * Number(invoice.taxRate)) / 100;
    const total = taxableAmount + taxAmount;

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal,
        discountAmount,
        taxAmount,
        total,
        amountDue: total - Number(invoice.amountPaid),
      },
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnectedFlag = true;
      this.logger.info('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnectedFlag = false;
      this.logger.info('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from database:', error);
      throw error;
    }
  }

  public getClient(): PrismaClient {
    return this.prisma;
  }

  public isConnected(): boolean {
    return this.isConnectedFlag;
  }

  // Transaction helper
  public async transaction(fn: (prisma: PrismaClient) => Promise<any>): Promise<any> {
    return this.prisma.$transaction(fn);
  }

  // Utility methods for common operations
  public async updateClientStatistics(clientId: string): Promise<void> {
    const [bookingStats, paymentStats] = await Promise.all([
      this.prisma.booking.aggregate({
        where: {
          clientId,
          status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          clientId,
          status: 'COMPLETED',
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        bookingCount: bookingStats._count,
        totalSpent: paymentStats._sum.amount || 0,
      },
    });
  }

  public async updateEquipmentUsage(equipmentId: string, hoursUsed: number): Promise<void> {
    await this.prisma.equipment.update({
      where: { id: equipmentId },
      data: {
        usageCount: { increment: 1 },
        totalHoursUsed: { increment: hoursUsed },
      },
    });
  }

  public async checkResourceAvailability(
    resourceType: 'equipment' | 'room',
    resourceId: string,
    startTime: Date,
    endTime: Date,
    excludeBookingId?: string
  ): Promise<boolean> {
    if (resourceType === 'equipment') {
      const conflicts = await this.prisma.equipmentAssignment.count({
        where: {
          equipmentId: resourceId,
          bookingId: excludeBookingId ? { not: excludeBookingId } : undefined,
          AND: [
            { checkedOutAt: { lt: endTime } },
            { expectedReturnAt: { gt: startTime } },
          ],
        },
      });
      return conflicts === 0;
    } else {
      const conflicts = await this.prisma.roomAssignment.count({
        where: {
          roomId: resourceId,
          bookingId: excludeBookingId ? { not: excludeBookingId } : undefined,
          AND: [
            { startDateTime: { lt: endTime } },
            { endDateTime: { gt: startTime } },
          ],
        },
      });
      return conflicts === 0;
    }
  }

  public async getExchangeRate(
    studioId: string,
    fromCurrency: string,
    toCurrency: string,
    date: Date = new Date()
  ): Promise<number> {
    if (fromCurrency === toCurrency) return 1;

    const rate = await this.prisma.currencyExchangeRate.findFirst({
      where: {
        studioId,
        fromCurrency: fromCurrency as any,
        toCurrency: toCurrency as any,
        validFrom: { lte: date },
        OR: [
          { validTo: null },
          { validTo: { gte: date } },
        ],
      },
      orderBy: { validFrom: 'desc' },
    });

    return rate ? Number(rate.rate) : 1;
  }

  // Cleanup methods
  public async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({
      where: {
        refreshExpiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }

  public async cleanupOldAuditLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });
    return result.count;
  }

  // Seed helper for development
  public async seed(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot seed database in production');
    }

    this.logger.info('Starting database seed...');

    // Check if already seeded
    const studioCount = await this.prisma.studio.count();
    if (studioCount > 0) {
      this.logger.info('Database already seeded, skipping...');
      return;
    }

    // Create demo studio
    const studio = await this.prisma.studio.create({
      data: {
        name: 'Demo Photography Studio',
        slug: 'demo-studio',
        email: 'admin@demostudio.com',
        phone: '+1234567890',
        website: 'https://demostudio.com',
        address: '123 Photo Street',
        city: 'New York',
        state: 'NY',
        country: 'US',
        postalCode: '10001',
        timezone: 'America/New_York',
        defaultCurrency: 'USD',
        taxRate: 8.875,
        businessHours: {
          mon: { open: '09:00', close: '18:00' },
          tue: { open: '09:00', close: '18:00' },
          wed: { open: '09:00', close: '18:00' },
          thu: { open: '09:00', close: '18:00' },
          fri: { open: '09:00', close: '18:00' },
          sat: { open: '10:00', close: '16:00' },
          sun: { closed: true },
        },
      },
    });

    // Create admin user
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin123', 10);

    await this.prisma.user.create({
      data: {
        studioId: studio.id,
        email: 'admin@demostudio.com',
        password: hashedPassword,
        role: 'STUDIO_ADMIN',
        firstName: 'Admin',
        lastName: 'User',
        emailVerified: true,
        hourlyRate: 150,
      },
    });

    // Create sample equipment
    const equipmentData = [
      {
        name: 'Canon EOS R5',
        category: 'Camera',
        subcategory: 'Mirrorless',
        brand: 'Canon',
        model: 'EOS R5',
        serialNumber: 'CN123456789',
        purchasePrice: 3899,
        currentValue: 3500,
        status: 'AVAILABLE' as const,
      },
      {
        name: 'Canon RF 24-70mm f/2.8L',
        category: 'Lens',
        subcategory: 'Zoom',
        brand: 'Canon',
        model: 'RF 24-70mm f/2.8L IS USM',
        serialNumber: 'LN987654321',
        purchasePrice: 2299,
        currentValue: 2100,
        status: 'AVAILABLE' as const,
      },
      {
        name: 'Profoto B10X',
        category: 'Lighting',
        subcategory: 'Strobe',
        brand: 'Profoto',
        model: 'B10X',
        serialNumber: 'PF456789123',
        purchasePrice: 2195,
        currentValue: 2000,
        status: 'AVAILABLE' as const,
      },
    ];

    for (const equipment of equipmentData) {
      await this.prisma.equipment.create({
        data: {
          ...equipment,
          studioId: studio.id,
        },
      });
    }

    // Create sample rooms
    const roomData = [
      {
        name: 'Main Studio',
        description: 'Large studio space with natural light',
        capacity: 10,
        pricePerHour: 150,
        pricePerHalfDay: 500,
        pricePerFullDay: 900,
        area: 150,
        features: ['Natural light', 'Blackout curtains', 'Backdrop system', 'Props storage'],
        hasNaturalLight: true,
        hasBlackoutOption: true,
      },
      {
        name: 'Portrait Studio',
        description: 'Intimate space perfect for portraits',
        capacity: 4,
        pricePerHour: 100,
        pricePerHalfDay: 350,
        pricePerFullDay: 600,
        area: 50,
        features: ['Controlled lighting', 'Multiple backdrops', 'Makeup station'],
        hasNaturalLight: false,
        hasBlackoutOption: false,
      },
    ];

    for (const room of roomData) {
      await this.prisma.room.create({
        data: {
          ...room,
          studioId: studio.id,
        },
      });
    }

    this.logger.info('Database seeded successfully');
  }
}