// packages/backend/src/services/database.service.ts
import { PrismaClient } from '@prisma/client';
import { LoggerService } from './logger.service';

export class DatabaseService {
  private static instance: DatabaseService;
  private prisma: PrismaClient;
  private logger = LoggerService.getInstance();
  private isConnected = false;

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

    this.setupEventHandlers();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private setupEventHandlers(): void {
    // Log database queries in development
    if (process.env.NODE_ENV === 'development') {
      this.prisma.$on('query', (e: any) => {
        this.logger.debug('Database Query:', {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
        });
      });
    }

    // Log database errors
    this.prisma.$on('error', (e: any) => {
      this.logger.error('Database Error:', e);
    });

    // Log database warnings
    this.prisma.$on('warn', (e: any) => {
      this.logger.warn('Database Warning:', e);
    });

    // Log database info
    this.prisma.$on('info', (e: any) => {
      this.logger.info('Database Info:', e);
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      this.logger.info('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      this.logger.info('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from database:', error);
      throw error;
    }
  }

  public getClient(): PrismaClient {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.prisma;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return false;
    }
  }

  // Transaction helper
  public async transaction<T>(
    callback: (prisma: PrismaClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  // Common database operations
  public async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        studio: true,
      },
    });
  }

  public async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        studio: true,
      },
    });
  }

  public async createUser(data: any) {
    return this.prisma.user.create({
      data,
      include: {
        studio: true,
      },
    });
  }

  public async updateUser(id: string, data: any) {
    return this.prisma.user.update({
      where: { id },
      data,
      include: {
        studio: true,
      },
    });
  }

  public async createStudio(data: any) {
    return this.prisma.studio.create({
      data,
    });
  }

  public async findStudioBySlug(slug: string) {
    return this.prisma.studio.findUnique({
      where: { slug },
    });
  }

  // Booking operations
  public async createBooking(data: any) {
    return this.prisma.booking.create({
      data,
      include: {
        client: true,
        studio: true,
        createdBy: true,
        assignments: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  public async findBookingsByStudio(studioId: string, filters?: any) {
    const where: any = { studioId };
    
    if (filters?.status) {
      where.status = filters.status;
    }
    
    if (filters?.startDate && filters?.endDate) {
      where.startDate = {
        gte: filters.startDate,
        lte: filters.endDate,
      };
    }

    return this.prisma.booking.findMany({
      where,
      include: {
        client: true,
        assignments: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        startDate: 'desc',
      },
    });
  }

  // Client operations
  public async createClient(data: any) {
    return this.prisma.client.create({
      data,
    });
  }

  public async findClientsByStudio(studioId: string) {
    return this.prisma.client.findMany({
      where: { studioId },
      include: {
        bookings: {
          include: {
            assignments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Equipment operations
  public async findEquipmentByStudio(studioId: string) {
    return this.prisma.equipment.findMany({
      where: { studioId },
      include: {
        assignments: {
          where: {
            checkedInAt: null, // Currently checked out
          },
          include: {
            user: true,
            booking: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  // Project operations
  public async findProjectsByStudio(studioId: string) {
    return this.prisma.project.findMany({
      where: { studioId },
      include: {
        booking: {
          include: {
            client: true,
          },
        },
        assignments: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Invoice operations
  public async findInvoicesByStudio(studioId: string) {
    return this.prisma.invoice.findMany({
      where: { studioId },
      include: {
        client: true,
        booking: true,
        lineItems: true,
        payments: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Dashboard statistics
  public async getDashboardStats(studioId: string) {
    const [
      totalClients,
      totalBookings,
      activeProjects,
      totalRevenue,
      recentBookings,
      recentProjects,
    ] = await Promise.all([
      this.prisma.client.count({ where: { studioId } }),
      this.prisma.booking.count({ where: { studioId } }),
      this.prisma.project.count({ 
        where: { 
          studioId,
          status: { in: ['IN_PROGRESS', 'IN_EDITING', 'CLIENT_REVIEW'] }
        } 
      }),
      this.prisma.payment.aggregate({
        where: { 
          studioId,
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      }),
      this.prisma.booking.findMany({
        where: { studioId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          client: true,
          assignments: {
            include: { user: true },
          },
        },
      }),
      this.prisma.project.findMany({
        where: { studioId },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: {
          booking: {
            include: { client: true },
          },
        },
      }),
    ]);

    return {
      totalClients,
      totalBookings,
      activeProjects,
      totalRevenue: totalRevenue._sum.amount || 0,
      recentBookings,
      recentProjects,
    };
  }
}