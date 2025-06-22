// File: packages/backend/src/services/database.service.ts
// Supabase-optimized Database Service

import { PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { LoggerService } from './logger.service';

export class DatabaseService {
  private static instance: DatabaseService;
  private prisma: PrismaClient;
  private supabase: SupabaseClient;
  private logger = LoggerService.getInstance();
  private isConnected = false;

  private constructor() {
    // Initialize Prisma client
    this.prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
    });

    // Initialize Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

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
      this.logger.info('✅ Supabase Database connected successfully');
      
      // Test Supabase connection
      const { data, error } = await this.supabase.from('studios').select('count').limit(1);
      if (error && error.code !== 'PGRST116') { // PGRST116 is table not found, which is OK during setup
        this.logger.warn('Supabase direct access warning:', error.message);
      } else {
        this.logger.info('✅ Supabase client initialized successfully');
      }
    } catch (error) {
      this.logger.error('❌ Failed to connect to Supabase database:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      this.logger.info('✅ Database disconnected successfully');
    } catch (error) {
      this.logger.error('❌ Failed to disconnect from database:', error);
      throw error;
    }
  }

  public getClient(): PrismaClient {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.prisma;
  }

  public getSupabase(): SupabaseClient {
    return this.supabase;
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

  // User operations
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

  // Studio operations
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

  public async findStudioById(id: string) {
    return this.prisma.studio.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });
  }

  // Booking operations
  public async createBooking(data: any) {
    return this.prisma.booking.create({
      data,
      include: {
        client: true,
        studio: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });
  }

  public async findBookingsByStudio(studioId: string, filters?: any) {
    const where: any = { studioId, deletedAt: null };
    
    if (filters?.status) {
      where.status = filters.status;
    }
    
    if (filters?.startDate && filters?.endDate) {
      where.startDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    }

    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    return this.prisma.booking.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            company: true,
          },
        },
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
      orderBy: {
        startDate: 'desc',
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  // Client operations
  public async createClient(data: any) {
    return this.prisma.client.create({
      data,
    });
  }

  public async findClientsByStudio(studioId: string, filters?: any) {
    const where: any = { studioId, deletedAt: null };

    if (filters?.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { company: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.client.findMany({
      where,
      include: {
        bookings: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            startDate: true,
            status: true,
            totalAmount: true,
            currency: true,
          },
          orderBy: { startDate: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            bookings: {
              where: { deletedAt: null },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  // Equipment operations
  public async findEquipmentByStudio(studioId: string, filters?: any) {
    const where: any = { studioId, deletedAt: null };

    if (filters?.category) {
      where.category = filters.category;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.equipment.findMany({
      where,
      include: {
        assignments: {
          where: {
            checkedInAt: null, // Currently checked out
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            booking: {
              select: {
                id: true,
                title: true,
                startDate: true,
                endDate: true,
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  // Project operations
  public async findProjectsByStudio(studioId: string, filters?: any) {
    const where: any = { studioId, deletedAt: null };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.editorId) {
      where.editorId = filters.editorId;
    }

    return this.prisma.project.findMany({
      where,
      include: {
        booking: {
          include: {
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                company: true,
              },
            },
          },
        },
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
        editor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        _count: {
          select: {
            files: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  // Invoice operations
  public async findInvoicesByStudio(studioId: string, filters?: any) {
    const where: any = { studioId, deletedAt: null };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    return this.prisma.invoice.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            company: true,
          },
        },
        booking: {
          select: {
            id: true,
            title: true,
            startDate: true,
          },
        },
        lineItems: true,
        payments: {
          select: {
            id: true,
            amount: true,
            status: true,
            paymentDate: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  // Dashboard statistics
  public async getDashboardStats(studioId: string) {
    const [
      totalClients,
      totalBookings,
      activeProjects,
      pendingInvoices,
      recentBookings,
      recentProjects,
      monthlyRevenue,
      equipmentInUse,
    ] = await Promise.all([
      // Total clients
      this.prisma.client.count({ 
        where: { studioId, deletedAt: null } 
      }),
      
      // Total bookings
      this.prisma.booking.count({ 
        where: { studioId, deletedAt: null } 
      }),
      
      // Active projects
      this.prisma.project.count({ 
        where: { 
          studioId,
          deletedAt: null,
          status: { in: ['IN_PROGRESS', 'IN_EDITING', 'CLIENT_REVIEW'] }
        } 
      }),
      
      // Pending invoices
      this.prisma.invoice.count({
        where: {
          studioId,
          deletedAt: null,
          status: { in: ['DRAFT', 'SENT', 'VIEWED'] }
        }
      }),
      
      // Recent bookings
      this.prisma.booking.findMany({
        where: { studioId, deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          client: {
            select: {
              firstName: true,
              lastName: true,
              company: true,
            },
          },
          assignments: {
            include: { 
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      }),
      
      // Recent projects
      this.prisma.project.findMany({
        where: { studioId, deletedAt: null },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: {
          booking: {
            include: { 
              client: {
                select: {
                  firstName: true,
                  lastName: true,
                  company: true,
                },
              },
            },
          },
        },
      }),
      
      // Monthly revenue (current month)
      this.prisma.payment.aggregate({
        where: { 
          studioId,
          status: 'COMPLETED',
          paymentDate: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
          },
        },
        _sum: { amount: true },
      }),
      
      // Equipment currently in use
      this.prisma.equipmentAssignment.count({
        where: {
          equipment: { studioId },
          checkedInAt: null,
        },
      }),
    ]);

    return {
      totalClients,
      totalBookings,
      activeProjects,
      pendingInvoices,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      equipmentInUse,
      recentBookings,
      recentProjects,
      generatedAt: new Date().toISOString(),
    };
  }

  // File operations with Supabase Storage
  public async uploadFile(
    bucketName: string, 
    filePath: string, 
    file: Buffer | Uint8Array | File,
    options?: { contentType?: string; metadata?: Record<string, string> }
  ) {
    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        contentType: options?.contentType,
        metadata: options?.metadata,
      });

    if (error) {
      this.logger.error('Supabase file upload error:', error);
      throw new Error(`File upload failed: ${error.message}`);
    }

    return data;
  }

  public async getFileUrl(bucketName: string, filePath: string) {
    const { data } = this.supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  public async deleteFile(bucketName: string, filePath: string) {
    const { error } = await this.supabase.storage
      .from(bucketName)
      .remove([filePath]);

    if (error) {
      this.logger.error('Supabase file deletion error:', error);
      throw new Error(`File deletion failed: ${error.message}`);
    }

    return true;
  }

  // Audit logging
  public async createAuditLog(data: {
    studioId: string;
    userId: string;
    action: string;
    entity: string;
    entityId?: string;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
    userAgent?: string;
    metadata?: any;
  }) {
    return this.prisma.auditLog.create({
      data,
    });
  }

  // Utility methods
  public async generateUniqueNumber(
    entity: 'booking' | 'invoice' | 'payment' | 'project',
    studioId: string,
    prefix?: string
  ): Promise<string> {
    const fieldMap = {
      booking: 'bookingNumber',
      invoice: 'invoiceNumber',
      payment: 'paymentNumber',
      project: 'projectNumber',
    };

    const field = fieldMap[entity];
    const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    const prefixPart = prefix || entity.toUpperCase().slice(0, 3);
    
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const randomNum = Math.floor(Math.random() * 9000) + 1000;
      const number = `${prefixPart}-${yearMonth}-${randomNum}`;

      const existing = await (this.prisma as any)[entity].findFirst({
        where: {
          studioId,
          [field]: number,
        },
      });

      if (!existing) {
        return number;
      }

      attempts++;
    }

    throw new Error(`Unable to generate unique ${entity} number after ${maxAttempts} attempts`);
  }
}