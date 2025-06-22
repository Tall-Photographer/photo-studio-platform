"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const client_1 = require("@prisma/client");
const supabase_js_1 = require("@supabase/supabase-js");
const logger_service_1 = require("./logger.service");
class DatabaseService {
  constructor() {
    this.logger = logger_service_1.LoggerService.getInstance();
    this.isConnected = false;
    this.prisma = new client_1.PrismaClient({
      log: [
        { emit: "event", level: "query" },
        { emit: "event", level: "error" },
        { emit: "event", level: "info" },
        { emit: "event", level: "warn" },
      ],
      errorFormat: "pretty",
    });
    this.supabase = (0, supabase_js_1.createClient)(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
    this.setupEventHandlers();
  }
  static getInstance() {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }
  setupEventHandlers() {
    if (process.env.NODE_ENV === "development") {
      this.prisma.$on("query", (e) => {
        this.logger.debug("Database Query:", {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
        });
      });
    }
    this.prisma.$on("error", (e) => {
      this.logger.error("Database Error:", e);
    });
    this.prisma.$on("warn", (e) => {
      this.logger.warn("Database Warning:", e);
    });
    this.prisma.$on("info", (e) => {
      this.logger.info("Database Info:", e);
    });
  }
  async connect() {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      this.logger.info("✅ Supabase Database connected successfully");
      const { data, error } = await this.supabase
        .from("studios")
        .select("count")
        .limit(1);
      if (error && error.code !== "PGRST116") {
        this.logger.warn("Supabase direct access warning:", error.message);
      } else {
        this.logger.info("✅ Supabase client initialized successfully");
      }
    } catch (error) {
      this.logger.error("❌ Failed to connect to Supabase database:", error);
      throw error;
    }
  }
  async disconnect() {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      this.logger.info("✅ Database disconnected successfully");
    } catch (error) {
      this.logger.error("❌ Failed to disconnect from database:", error);
      throw error;
    }
  }
  getClient() {
    if (!this.isConnected) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.prisma;
  }
  getSupabase() {
    return this.supabase;
  }
  async healthCheck() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error("Database health check failed:", error);
      return false;
    }
  }
  async transaction(callback) {
    return this.prisma.$transaction(callback);
  }
  async findUserByEmail(email) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        studio: true,
      },
    });
  }
  async findUserById(id) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        studio: true,
      },
    });
  }
  async createUser(data) {
    return this.prisma.user.create({
      data,
      include: {
        studio: true,
      },
    });
  }
  async updateUser(id, data) {
    return this.prisma.user.update({
      where: { id },
      data,
      include: {
        studio: true,
      },
    });
  }
  async createStudio(data) {
    return this.prisma.studio.create({
      data,
    });
  }
  async findStudioBySlug(slug) {
    return this.prisma.studio.findUnique({
      where: { slug },
    });
  }
  async findStudioById(id) {
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
  async createBooking(data) {
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
  async findBookingsByStudio(studioId, filters) {
    const where = { studioId, deletedAt: null };
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
        startDate: "desc",
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }
  async createClient(data) {
    return this.prisma.client.create({
      data,
    });
  }
  async findClientsByStudio(studioId, filters) {
    const where = { studioId, deletedAt: null };
    if (filters?.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
        { company: { contains: filters.search, mode: "insensitive" } },
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
          orderBy: { startDate: "desc" },
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
        createdAt: "desc",
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }
  async findEquipmentByStudio(studioId, filters) {
    const where = { studioId, deletedAt: null };
    if (filters?.category) {
      where.category = filters.category;
    }
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { brand: { contains: filters.search, mode: "insensitive" } },
        { model: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    return this.prisma.equipment.findMany({
      where,
      include: {
        assignments: {
          where: {
            checkedInAt: null,
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
        name: "asc",
      },
    });
  }
  async findProjectsByStudio(studioId, filters) {
    const where = { studioId, deletedAt: null };
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
        updatedAt: "desc",
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }
  async findInvoicesByStudio(studioId, filters) {
    const where = { studioId, deletedAt: null };
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
        createdAt: "desc",
      },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }
  async getDashboardStats(studioId) {
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
      this.prisma.client.count({
        where: { studioId, deletedAt: null },
      }),
      this.prisma.booking.count({
        where: { studioId, deletedAt: null },
      }),
      this.prisma.project.count({
        where: {
          studioId,
          deletedAt: null,
          status: { in: ["IN_PROGRESS", "IN_EDITING", "CLIENT_REVIEW"] },
        },
      }),
      this.prisma.invoice.count({
        where: {
          studioId,
          deletedAt: null,
          status: { in: ["DRAFT", "SENT", "VIEWED"] },
        },
      }),
      this.prisma.booking.findMany({
        where: { studioId, deletedAt: null },
        take: 5,
        orderBy: { createdAt: "desc" },
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
      this.prisma.project.findMany({
        where: { studioId, deletedAt: null },
        take: 5,
        orderBy: { updatedAt: "desc" },
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
      this.prisma.payment.aggregate({
        where: {
          studioId,
          status: "COMPLETED",
          paymentDate: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            lt: new Date(
              new Date().getFullYear(),
              new Date().getMonth() + 1,
              1,
            ),
          },
        },
        _sum: { amount: true },
      }),
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
  async uploadFile(bucketName, filePath, file, options) {
    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        contentType: options?.contentType,
        metadata: options?.metadata,
      });
    if (error) {
      this.logger.error("Supabase file upload error:", error);
      throw new Error(`File upload failed: ${error.message}`);
    }
    return data;
  }
  async getFileUrl(bucketName, filePath) {
    const { data } = this.supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);
    return data.publicUrl;
  }
  async deleteFile(bucketName, filePath) {
    const { error } = await this.supabase.storage
      .from(bucketName)
      .remove([filePath]);
    if (error) {
      this.logger.error("Supabase file deletion error:", error);
      throw new Error(`File deletion failed: ${error.message}`);
    }
    return true;
  }
  async createAuditLog(data) {
    return this.prisma.auditLog.create({
      data,
    });
  }
  async generateUniqueNumber(entity, studioId, prefix) {
    const fieldMap = {
      booking: "bookingNumber",
      invoice: "invoiceNumber",
      payment: "paymentNumber",
      project: "projectNumber",
    };
    const field = fieldMap[entity];
    const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
    const prefixPart = prefix || entity.toUpperCase().slice(0, 3);
    let attempts = 0;
    const maxAttempts = 100;
    while (attempts < maxAttempts) {
      const randomNum = Math.floor(Math.random() * 9000) + 1000;
      const number = `${prefixPart}-${yearMonth}-${randomNum}`;
      const existing = await this.prisma[entity].findFirst({
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
    throw new Error(
      `Unable to generate unique ${entity} number after ${maxAttempts} attempts`,
    );
  }
}
exports.DatabaseService = DatabaseService;
