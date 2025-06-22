// packages/backend/src/services/equipment.service.ts
import { Equipment, EquipmentStatus, Prisma } from '@prisma/client';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { QRCodeService } from './qrcode.service';
import { FileService } from './file.service';
import dayjs from 'dayjs';

interface EquipmentFilters {
  search?: string;
  category?: string;
  subcategory?: string;
  status?: EquipmentStatus;
  isAvailable?: boolean;
  isRentable?: boolean;
  needsMaintenance?: boolean;
  tags?: string[];
  minValue?: number;
  maxValue?: number;
}

interface EquipmentStats {
  totalEquipment: number;
  availableEquipment: number;
  inUseEquipment: number;
  maintenanceRequired: number;
  totalValue: number;
  utilizationRate: number;
  maintenanceCompliance: number;
  categoryBreakdown: Record<string, number>;
  statusBreakdown: Record<string, number>;
  ageDistribution: Array<{ range: string; count: number }>;
}

interface MaintenanceSchedule {
  equipmentId: string;
  equipment: Equipment;
  lastMaintenance?: Date;
  nextDue: Date;
  daysUntilDue: number;
  isOverdue: boolean;
  maintenanceType: string;
}

export class EquipmentService {
  private static instance: EquipmentService;
  private db = DatabaseService.getInstance().getClient();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();
  private notificationService = NotificationService.getInstance();
  private qrCodeService = QRCodeService.getInstance();
  private fileService = FileService.getInstance();

  private constructor() {}

  public static getInstance(): EquipmentService {
    if (!EquipmentService.instance) {
      EquipmentService.instance = new EquipmentService();
    }
    return EquipmentService.instance;
  }

  // Get equipment with filters
  public async getEquipment(
    studioId: string,
    filters: EquipmentFilters,
    page: number = 1,
    limit: number = 20
  ) {
    const where: Prisma.EquipmentWhereInput = {
      studioId,
      deletedAt: null,
    };

    // Apply filters
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { serialNumber: { contains: filters.search } },
        { barcode: { contains: filters.search } },
      ];
    }

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.subcategory) {
      where.subcategory = filters.subcategory;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.isAvailable !== undefined) {
      where.status = filters.isAvailable ? 'AVAILABLE' : { not: 'AVAILABLE' };
    }

    if (filters.isRentable !== undefined) {
      where.isRentable = filters.isRentable;
    }

    if (filters.tags?.length) {
      where.tags = { hasSome: filters.tags };
    }

    if (filters.minValue !== undefined) {
      where.currentValue = { gte: filters.minValue };
    }

    if (filters.maxValue !== undefined) {
      where.currentValue = { ...where.currentValue, lte: filters.maxValue };
    }

    if (filters.needsMaintenance) {
      const today = new Date();
      where.OR = [
        { nextMaintenanceDate: { lte: today } },
        { nextMaintenanceDate: null },
      ];
    }

    const [equipment, total] = await Promise.all([
      this.db.equipment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
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
                  bookingNumber: true,
                },
              },
            },
          },
          _count: {
            select: {
              assignments: true,
              maintenanceLogs: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.db.equipment.count({ where }),
    ]);

    return {
      equipment,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get equipment by ID
  public async getEquipmentById(equipmentId: string, studioId: string) {
    const equipment = await this.db.equipment.findFirst({
      where: {
        id: equipmentId,
        studioId,
        deletedAt: null,
      },
      include: {
        assignments: {
          orderBy: { checkedOutAt: 'desc' },
          take: 10,
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            booking: {
              select: {
                id: true,
                title: true,
                bookingNumber: true,
                client: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        maintenanceLogs: {
          orderBy: { performedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!equipment) {
      throw new Error('Equipment not found');
    }

    // Calculate depreciation
    const depreciation = this.calculateDepreciation(equipment);

    // Get utilization stats
    const utilizationStats = await this.getEquipmentUtilization(equipmentId);

    return {
      ...equipment,
      depreciation,
      utilizationStats,
    };
  }

  // Create equipment
  public async createEquipment(
    data: Prisma.EquipmentCreateInput,
    userId: string,
    imageFile?: Express.Multer.File
  ) {
    // Generate unique codes
    const barcode = await this.generateUniqueBarcode(data.studio.connect?.id!);
    const qrCode = await this.qrCodeService.generateEquipmentQRCode(barcode);

    // Upload image if provided
    let imageUrl: string | undefined;
    if (imageFile) {
      const uploadResult = await this.fileService.uploadFile(
        imageFile,
        'equipment',
        data.studio.connect?.id!
      );
      imageUrl = uploadResult.url;
    }

    const equipment = await this.db.equipment.create({
      data: {
        ...data,
        barcode,
        qrCode,
        imageUrl,
        currentValue: data.currentValue || data.purchasePrice,
      },
    });

    // Set initial maintenance schedule
    if (data.category && this.getMaintenanceInterval(data.category)) {
      await this.scheduleNextMaintenance(equipment.id);
    }

    // Audit log
    await this.auditService.log({
      studioId: equipment.studioId,
      userId,
      action: 'EQUIPMENT_CREATED',
      entity: 'Equipment',
      entityId: equipment.id,
      metadata: {
        name: equipment.name,
        category: equipment.category,
        value: equipment.purchasePrice,
      },
    });

    return equipment;
  }

  // Update equipment
  public async updateEquipment(
    equipmentId: string,
    studioId: string,
    data: Prisma.EquipmentUpdateInput,
    userId: string
  ) {
    const equipment = await this.getEquipmentById(equipmentId, studioId);

    const oldValues = { ...equipment };

    const updated = await this.db.equipment.update({
      where: { id: equipmentId },
      data,
    });

    // Update usage stats if status changed
    if (oldValues.status !== updated.status) {
      await this.handleStatusChange(updated, oldValues.status, userId);
    }

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EQUIPMENT_UPDATED',
      entity: 'Equipment',
      entityId: equipmentId,
      oldValues,
      newValues: updated,
    });

    return updated;
  }

  // Delete equipment
  public async deleteEquipment(equipmentId: string, studioId: string, userId: string) {
    const equipment = await this.getEquipmentById(equipmentId, studioId);

    // Check if equipment is currently assigned
    const activeAssignments = await this.db.equipmentAssignment.count({
      where: {
        equipmentId,
        checkedInAt: null,
      },
    });

    if (activeAssignments > 0) {
      throw new Error('Cannot delete equipment that is currently checked out');
    }

    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { deletedAt: new Date() },
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EQUIPMENT_DELETED',
      entity: 'Equipment',
      entityId: equipmentId,
    });

    return { success: true };
  }

  // Check out equipment
  public async checkOutEquipment(
    equipmentId: string,
    userId: string,
    bookingId: string | null,
    expectedReturnAt: Date,
    notes?: string
  ) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });

    if (!equipment) {
      throw new Error('Equipment not found');
    }

    if (equipment.status !== 'AVAILABLE') {
      throw new Error(`Equipment is ${equipment.status.toLowerCase()}`);
    }

    // Create assignment
    const assignment = await this.db.equipmentAssignment.create({
      data: {
        equipmentId,
        userId,
        bookingId,
        expectedReturnAt,
        checkOutCondition: equipment.condition,
        checkOutNotes: notes,
      },
    });

    // Update equipment status
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { status: 'IN_USE' },
    });

    // Send reminder notification
    const reminderDate = dayjs(expectedReturnAt).subtract(1, 'hour').toDate();
    await this.notificationService.scheduleNotification({
      userId,
      type: 'EQUIPMENT_RETURN_REMINDER',
      title: 'Equipment Return Reminder',
      message: `Please remember to return ${equipment.name} by ${dayjs(expectedReturnAt).format('h:mm A')}`,
      scheduledFor: reminderDate,
      metadata: { equipmentId, assignmentId: assignment.id },
    });

    return assignment;
  }

  // Check in equipment
  public async checkInEquipment(
    assignmentId: string,
    condition: string,
    notes?: string,
    damageReported: boolean = false,
    damageDescription?: string
  ) {
    const assignment = await this.db.equipmentAssignment.findUnique({
      where: { id: assignmentId },
      include: { equipment: true },
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    if (assignment.checkedInAt) {
      throw new Error('Equipment already checked in');
    }

    // Update assignment
    const updatedAssignment = await this.db.equipmentAssignment.update({
      where: { id: assignmentId },
      data: {
        checkedInAt: new Date(),
        checkInCondition: condition,
        checkInNotes: notes,
        damageReported,
        damageDescription,
      },
    });

    // Update equipment
    await this.db.equipment.update({
      where: { id: assignment.equipmentId },
      data: {
        status: damageReported ? 'MAINTENANCE' : 'AVAILABLE',
        condition,
        usageCount: { increment: 1 },
        totalHoursUsed: {
          increment: dayjs().diff(assignment.checkedOutAt, 'hours', true),
        },
      },
    });

    // If damage reported, create maintenance log
    if (damageReported) {
      await this.db.maintenanceLog.create({
        data: {
          equipmentId: assignment.equipmentId,
          type: 'repair',
          description: `Damage reported: ${damageDescription}`,
          performedBy: 'Pending',
          notes: `Reported during check-in by user ${assignment.userId}`,
        },
      });

      // Notify maintenance team
      await this.notificationService.notifyMaintenanceTeam({
        equipmentId: assignment.equipmentId,
        equipmentName: assignment.equipment.name,
        issue: damageDescription || 'Damage reported',
        reportedBy: assignment.userId,
      });
    }

    return updatedAssignment;
  }

  // Get equipment availability
  public async checkEquipmentAvailability(
    equipmentIds: string[],
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
  ) {
    const availability = await Promise.all(
      equipmentIds.map(async (equipmentId) => {
        const conflicts = await this.db.equipmentAssignment.findMany({
          where: {
            equipmentId,
            bookingId: excludeBookingId ? { not: excludeBookingId } : undefined,
            AND: [
              { checkedOutAt: { lt: endDate } },
              {
                OR: [
                  { checkedInAt: null },
                  { checkedInAt: { gt: startDate } },
                ],
              },
            ],
          },
          include: {
            booking: {
              select: {
                id: true,
                title: true,
                startDateTime: true,
                endDateTime: true,
              },
            },
          },
        });

        const equipment = await this.db.equipment.findUnique({
          where: { id: equipmentId },
          select: {
            id: true,
            name: true,
            status: true,
          },
        });

        return {
          equipmentId,
          equipment,
          isAvailable: conflicts.length === 0 && equipment?.status === 'AVAILABLE',
          conflicts,
        };
      })
    );

    return availability;
  }

  // Equipment maintenance
  public async logMaintenance(
    equipmentId: string,
    data: {
      type: string;
      description: string;
      performedBy: string;
      cost?: number;
      nextDueDate?: Date;
      partsReplaced?: string[];
      notes?: string;
    },
    userId: string
  ) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });

    if (!equipment) {
      throw new Error('Equipment not found');
    }

    // Create maintenance log
    const maintenanceLog = await this.db.maintenanceLog.create({
      data: {
        equipmentId,
        type: data.type,
        description: data.description,
        performedBy: data.performedBy,
        cost: data.cost,
        currency: equipment.currency,
        nextDueDate: data.nextDueDate,
        partsReplaced: data.partsReplaced || [],
        notes: data.notes,
      },
    });

    // Update equipment
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: {
        lastMaintenanceDate: new Date(),
        nextMaintenanceDate: data.nextDueDate,
        status: 'AVAILABLE', // Assume maintenance is complete
      },
    });

    // Schedule next maintenance reminder if due date provided
    if (data.nextDueDate) {
      const reminderDate = dayjs(data.nextDueDate).subtract(7, 'days').toDate();
      await this.notificationService.scheduleMaintenanceReminder({
        equipmentId,
        equipmentName: equipment.name,
        dueDate: data.nextDueDate,
        reminderDate,
      });
    }

    // Audit log
    await this.auditService.log({
      studioId: equipment.studioId,
      userId,
      action: 'EQUIPMENT_MAINTENANCE_LOGGED',
      entity: 'Equipment',
      entityId: equipmentId,
      metadata: {
        maintenanceType: data.type,
        cost: data.cost,
      },
    });

    return maintenanceLog;
  }

  // Get maintenance schedule
  public async getMaintenanceSchedule(
    studioId: string,
    daysAhead: number = 30
  ): Promise<MaintenanceSchedule[]> {
    const cutoffDate = dayjs().add(daysAhead, 'days').toDate();

    const equipment = await this.db.equipment.findMany({
      where: {
        studioId,
        deletedAt: null,
        status: { not: 'RETIRED' },
        OR: [
          { nextMaintenanceDate: { lte: cutoffDate } },
          { nextMaintenanceDate: null },
        ],
      },
      include: {
        maintenanceLogs: {
          orderBy: { performedAt: 'desc' },
          take: 1,
        },
      },
    });

    return equipment.map((eq) => {
      const lastMaintenance = eq.maintenanceLogs[0];
      const nextDue = eq.nextMaintenanceDate || this.calculateNextMaintenanceDate(eq);
      const daysUntilDue = dayjs(nextDue).diff(dayjs(), 'days');

      return {
        equipmentId: eq.id,
        equipment: eq,
        lastMaintenance: lastMaintenance?.performedAt,
        nextDue,
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
        maintenanceType: this.getMaintenanceType(eq.category),
      };
    }).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }

  // Equipment statistics
  public async getEquipmentStats(studioId: string): Promise<EquipmentStats> {
    const [
      totalEquipment,
      statusCounts,
      categoryBreakdown,
      valueData,
      utilizationData,
      maintenanceData,
      ageData,
    ] = await Promise.all([
      // Total equipment count
      this.db.equipment.count({
        where: { studioId, deletedAt: null },
      }),
      // Status breakdown
      this.db.equipment.groupBy({
        by: ['status'],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      // Category breakdown
      this.db.equipment.groupBy({
        by: ['category'],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      // Total value
      this.db.equipment.aggregate({
        where: { studioId, deletedAt: null },
        _sum: { currentValue: true },
      }),
      // Utilization data
      this.db.$queryRaw<any[]>`
        SELECT 
          e.id,
          e."totalHoursUsed",
          EXTRACT(EPOCH FROM (NOW() - e."purchaseDate")) / 3600 as total_hours_owned
        FROM "Equipment" e
        WHERE e."studioId" = ${studioId}
          AND e."deletedAt" IS NULL
          AND e."purchaseDate" IS NOT NULL
      `,
      // Maintenance compliance
      this.db.equipment.count({
        where: {
          studioId,
          deletedAt: null,
          nextMaintenanceDate: { lte: new Date() },
        },
      }),
      // Age distribution
      this.db.$queryRaw<any[]>`
        SELECT 
          CASE 
            WHEN EXTRACT(YEAR FROM AGE(NOW(), "purchaseDate")) < 1 THEN '< 1 year'
            WHEN EXTRACT(YEAR FROM AGE(NOW(), "purchaseDate")) < 3 THEN '1-3 years'
            WHEN EXTRACT(YEAR FROM AGE(NOW(), "purchaseDate")) < 5 THEN '3-5 years'
            ELSE '5+ years'
          END as age_range,
          COUNT(*) as count
        FROM "Equipment"
        WHERE "studioId" = ${studioId}
          AND "deletedAt" IS NULL
          AND "purchaseDate" IS NOT NULL
        GROUP BY age_range
      `,
    ]);

    // Process status counts
    const statusBreakdown: Record<string, number> = {};
    statusCounts.forEach((item) => {
      statusBreakdown[item.status] = item._count;
    });

    // Process category breakdown
    const categoryMap: Record<string, number> = {};
    categoryBreakdown.forEach((item) => {
      categoryMap[item.category] = item._count;
    });

    // Calculate utilization rate
    const totalUtilization = utilizationData.reduce((sum, eq) => {
      const utilization = eq.total_hours_owned > 0
        ? (Number(eq.totalHoursUsed) / eq.total_hours_owned) * 100
        : 0;
      return sum + utilization;
    }, 0);
    const utilizationRate = utilizationData.length > 0
      ? totalUtilization / utilizationData.length
      : 0;

    // Calculate maintenance compliance
    const maintenanceCompliance = totalEquipment > 0
      ? ((totalEquipment - maintenanceData) / totalEquipment) * 100
      : 100;

    return {
      totalEquipment,
      availableEquipment: statusBreakdown['AVAILABLE'] || 0,
      inUseEquipment: statusBreakdown['IN_USE'] || 0,
      maintenanceRequired: maintenanceData,
      totalValue: Number(valueData._sum.currentValue || 0),
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      maintenanceCompliance: Math.round(maintenanceCompliance * 100) / 100,
      categoryBreakdown: categoryMap,
      statusBreakdown,
      ageDistribution: ageData.map((item) => ({
        range: item.age_range,
        count: Number(item.count),
      })),
    };
  }

  // Calculate depreciation
  private calculateDepreciation(equipment: Equipment) {
    if (!equipment.purchaseDate || !equipment.purchasePrice) {
      return {
        currentValue: Number(equipment.currentValue || 0),
        totalDepreciation: 0,
        annualDepreciation: 0,
        depreciationRate: 0,
      };
    }

    const yearsOwned = dayjs().diff(equipment.purchaseDate, 'years', true);
    const depreciationRate = this.getDepreciationRate(equipment.category);
    const annualDepreciation = Number(equipment.purchasePrice) * depreciationRate;
    const totalDepreciation = annualDepreciation * yearsOwned;
    const currentValue = Math.max(
      Number(equipment.purchasePrice) - totalDepreciation,
      Number(equipment.purchasePrice) * 0.1 // Minimum 10% residual value
    );

    return {
      currentValue: Math.round(currentValue * 100) / 100,
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
      annualDepreciation: Math.round(annualDepreciation * 100) / 100,
      depreciationRate: depreciationRate * 100,
      yearsOwned: Math.round(yearsOwned * 10) / 10,
    };
  }

  // Get equipment utilization
  private async getEquipmentUtilization(equipmentId: string) {
    const thirtyDaysAgo = dayjs().subtract(30, 'days').toDate();
    const ninetyDaysAgo = dayjs().subtract(90, 'days').toDate();

    const [last30Days, last90Days, allTime] = await Promise.all([
      this.db.equipmentAssignment.aggregate({
        where: {
          equipmentId,
          checkedOutAt: { gte: thirtyDaysAgo },
        },
        _count: true,
      }),
      this.db.equipmentAssignment.aggregate({
        where: {
          equipmentId,
          checkedOutAt: { gte: ninetyDaysAgo },
        },
        _count: true,
      }),
      this.db.equipmentAssignment.aggregate({
        where: { equipmentId },
        _count: true,
      }),
    ]);

    return {
      last30Days: last30Days._count,
      last90Days: last90Days._count,
      allTime: allTime._count,
    };
  }

  // Generate unique barcode
  private async generateUniqueBarcode(studioId: string): Promise<string> {
    let barcode: string;
    let exists = true;

    while (exists) {
      barcode = `EQ${studioId.slice(-4)}${Date.now().toString(36).toUpperCase()}`;
      exists = await this.db.equipment.findUnique({
        where: { barcode },
      }) !== null;
    }

    return barcode!;
  }

  // Handle status change
  private async handleStatusChange(
    equipment: Equipment,
    oldStatus: EquipmentStatus,
    userId: string
  ) {
    // If moving to maintenance, notify maintenance team
    if (equipment.status === 'MAINTENANCE' && oldStatus !== 'MAINTENANCE') {
      await this.notificationService.notifyMaintenanceTeam({
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        issue: 'Equipment moved to maintenance status',
        reportedBy: userId,
      });
    }

    // If retiring equipment, update financial records
    if (equipment.status === 'RETIRED' && oldStatus !== 'RETIRED') {
      await this.db.equipment.update({
        where: { id: equipment.id },
        data: { currentValue: 0 },
      });
    }
  }

  // Schedule next maintenance
  private async scheduleNextMaintenance(equipmentId: string) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });

    if (!equipment) return;

    const interval = this.getMaintenanceInterval(equipment.category);
    if (!interval) return;

    const nextDate = dayjs().add(interval, 'days').toDate();

    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { nextMaintenanceDate: nextDate },
    });
  }

  // Get maintenance interval by category
  private getMaintenanceInterval(category: string): number | null {
    const intervals: Record<string, number> = {
      Camera: 180, // 6 months
      Lens: 365, // 1 year
      Lighting: 90, // 3 months
      Audio: 180, // 6 months
      Tripod: 365, // 1 year
      Computer: 90, // 3 months
      Drone: 60, // 2 months
    };

    return intervals[category] || null;
  }

  // Get depreciation rate by category
  private getDepreciationRate(category: string): number {
    const rates: Record<string, number> = {
      Camera: 0.2, // 20% per year
      Lens: 0.15, // 15% per year
      Lighting: 0.25, // 25% per year
      Audio: 0.2, // 20% per year
      Computer: 0.33, // 33% per year
      Drone: 0.3, // 30% per year
      Default: 0.2, // 20% per year
    };

    return rates[category] || rates.Default;
  }

  // Get maintenance type
  private getMaintenanceType(category: string): string {
    const types: Record<string, string> = {
      Camera: 'Sensor cleaning and calibration',
      Lens: 'Cleaning and calibration',
      Lighting: 'Bulb check and electrical testing',
      Audio: 'Connection testing and cleaning',
      Computer: 'Software updates and cleaning',
      Drone: 'Motor and battery check',
    };

    return types[category] || 'General maintenance';
  }

  // Calculate next maintenance date
  private calculateNextMaintenanceDate(equipment: Equipment): Date {
    const interval = this.getMaintenanceInterval(equipment.category) || 180;
    const baseDate = equipment.lastMaintenanceDate || equipment.purchaseDate || equipment.createdAt;
    return dayjs(baseDate).add(interval, 'days').toDate();
  }

  // Batch equipment operations
  public async batchUpdateEquipment(
    equipmentIds: string[],
    studioId: string,
    updates: Prisma.EquipmentUpdateInput,
    userId: string
  ) {
    // Verify all equipment belongs to studio
    const equipment = await this.db.equipment.findMany({
      where: {
        id: { in: equipmentIds },
        studioId,
        deletedAt: null,
      },
    });

    if (equipment.length !== equipmentIds.length) {
      throw new Error('Some equipment not found or not accessible');
    }

    // Update all equipment
    const result = await this.db.equipment.updateMany({
      where: {
        id: { in: equipmentIds },
      },
      data: updates,
    });

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'EQUIPMENT_BATCH_UPDATE',
      entity: 'Equipment',
      metadata: {
        count: result.count,
        updates,
      },
    });

    return result;
  }

  // Equipment templates for quick creation
  public async getEquipmentTemplates(category?: string) {
    const templates = [
      {
        category: 'Camera',
        templates: [
          {
            name: 'Canon EOS R5',
            brand: 'Canon',
            model: 'EOS R5',
            subcategory: 'Mirrorless',
            specifications: {
              sensor: 'Full-frame 45MP',
              video: '8K RAW',
              stabilization: 'IBIS',
            },
          },
          {
            name: 'Sony A7R V',
            brand: 'Sony',
            model: 'A7R V',
            subcategory: 'Mirrorless',
            specifications: {
              sensor: 'Full-frame 61MP',
              video: '8K',
              stabilization: 'IBIS',
            },
          },
        ],
      },
      {
        category: 'Lens',
        templates: [
          {
            name: 'Canon RF 24-70mm f/2.8L',
            brand: 'Canon',
            model: 'RF 24-70mm f/2.8L IS USM',
            subcategory: 'Zoom',
            specifications: {
              focalLength: '24-70mm',
              aperture: 'f/2.8',
              stabilization: 'IS',
            },
          },
          {
            name: 'Sony FE 85mm f/1.4 GM',
            brand: 'Sony',
            model: 'FE 85mm f/1.4 GM',
            subcategory: 'Prime',
            specifications: {
              focalLength: '85mm',
              aperture: 'f/1.4',
              type: 'Portrait',
            },
          },
        ],
      },
      {
        category: 'Lighting',
        templates: [
          {
            name: 'Profoto B10X',
            brand: 'Profoto',
            model: 'B10X',
            subcategory: 'Strobe',
            specifications: {
              power: '250Ws',
              battery: 'Built-in',
              ttl: 'Yes',
            },
          },
          {
            name: 'Aputure 600d Pro',
            brand: 'Aputure',
            model: '600d Pro',
            subcategory: 'LED',
            specifications: {
              power: '600W',
              colorTemp: '5600K',
              wireless: 'Yes',
            },
          },
        ],
      },
    ];

    if (category) {
      return templates.find(t => t.category === category)?.templates || [];
    }

    return templates;
  }
}