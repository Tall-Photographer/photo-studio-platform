"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentService = void 0;
const database_service_1 = require("./database.service");
const logger_service_1 = require("./logger.service");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const qrcode_service_1 = require("./qrcode.service");
const file_service_1 = require("./file.service");
const dayjs_1 = __importDefault(require("dayjs"));
class EquipmentService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.logger = logger_service_1.LoggerService.getInstance();
    this.auditService = audit_service_1.AuditService.getInstance();
    this.notificationService =
      notification_service_1.NotificationService.getInstance();
    this.qrCodeService = qrcode_service_1.QRCodeService.getInstance();
    this.fileService = file_service_1.FileService.getInstance();
  }
  static getInstance() {
    if (!EquipmentService.instance) {
      EquipmentService.instance = new EquipmentService();
    }
    return EquipmentService.instance;
  }
  async getEquipment(studioId, filters, page = 1, limit = 20) {
    const where = {
      studioId,
      deletedAt: null,
    };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { brand: { contains: filters.search, mode: "insensitive" } },
        { model: { contains: filters.search, mode: "insensitive" } },
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
      where.status = filters.isAvailable ? "AVAILABLE" : { not: "AVAILABLE" };
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
        orderBy: { name: "asc" },
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
  async getEquipmentById(equipmentId, studioId) {
    const equipment = await this.db.equipment.findFirst({
      where: {
        id: equipmentId,
        studioId,
        deletedAt: null,
      },
      include: {
        assignments: {
          orderBy: { checkedOutAt: "desc" },
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
          orderBy: { performedAt: "desc" },
          take: 10,
        },
      },
    });
    if (!equipment) {
      throw new Error("Equipment not found");
    }
    const depreciation = this.calculateDepreciation(equipment);
    const utilizationStats = await this.getEquipmentUtilization(equipmentId);
    return {
      ...equipment,
      depreciation,
      utilizationStats,
    };
  }
  async createEquipment(data, userId, imageFile) {
    const barcode = await this.generateUniqueBarcode(data.studio.connect?.id);
    const qrCode = await this.qrCodeService.generateEquipmentQRCode(barcode);
    let imageUrl;
    if (imageFile) {
      const uploadResult = await this.fileService.uploadFile(
        imageFile,
        "equipment",
        data.studio.connect?.id,
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
    if (data.category && this.getMaintenanceInterval(data.category)) {
      await this.scheduleNextMaintenance(equipment.id);
    }
    await this.auditService.log({
      studioId: equipment.studioId,
      userId,
      action: "EQUIPMENT_CREATED",
      entity: "Equipment",
      entityId: equipment.id,
      metadata: {
        name: equipment.name,
        category: equipment.category,
        value: equipment.purchasePrice,
      },
    });
    return equipment;
  }
  async updateEquipment(equipmentId, studioId, data, userId) {
    const equipment = await this.getEquipmentById(equipmentId, studioId);
    const oldValues = { ...equipment };
    const updated = await this.db.equipment.update({
      where: { id: equipmentId },
      data,
    });
    if (oldValues.status !== updated.status) {
      await this.handleStatusChange(updated, oldValues.status, userId);
    }
    await this.auditService.log({
      studioId,
      userId,
      action: "EQUIPMENT_UPDATED",
      entity: "Equipment",
      entityId: equipmentId,
      oldValues,
      newValues: updated,
    });
    return updated;
  }
  async deleteEquipment(equipmentId, studioId, userId) {
    const equipment = await this.getEquipmentById(equipmentId, studioId);
    const activeAssignments = await this.db.equipmentAssignment.count({
      where: {
        equipmentId,
        checkedInAt: null,
      },
    });
    if (activeAssignments > 0) {
      throw new Error("Cannot delete equipment that is currently checked out");
    }
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "EQUIPMENT_DELETED",
      entity: "Equipment",
      entityId: equipmentId,
    });
    return { success: true };
  }
  async checkOutEquipment(
    equipmentId,
    userId,
    bookingId,
    expectedReturnAt,
    notes,
  ) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new Error("Equipment not found");
    }
    if (equipment.status !== "AVAILABLE") {
      throw new Error(`Equipment is ${equipment.status.toLowerCase()}`);
    }
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
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { status: "IN_USE" },
    });
    const reminderDate = (0, dayjs_1.default)(expectedReturnAt)
      .subtract(1, "hour")
      .toDate();
    await this.notificationService.scheduleNotification({
      userId,
      type: "EQUIPMENT_RETURN_REMINDER",
      title: "Equipment Return Reminder",
      message: `Please remember to return ${equipment.name} by ${(0, dayjs_1.default)(expectedReturnAt).format("h:mm A")}`,
      scheduledFor: reminderDate,
      metadata: { equipmentId, assignmentId: assignment.id },
    });
    return assignment;
  }
  async checkInEquipment(
    assignmentId,
    condition,
    notes,
    damageReported = false,
    damageDescription,
  ) {
    const assignment = await this.db.equipmentAssignment.findUnique({
      where: { id: assignmentId },
      include: { equipment: true },
    });
    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (assignment.checkedInAt) {
      throw new Error("Equipment already checked in");
    }
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
    await this.db.equipment.update({
      where: { id: assignment.equipmentId },
      data: {
        status: damageReported ? "MAINTENANCE" : "AVAILABLE",
        condition,
        usageCount: { increment: 1 },
        totalHoursUsed: {
          increment: (0, dayjs_1.default)().diff(
            assignment.checkedOutAt,
            "hours",
            true,
          ),
        },
      },
    });
    if (damageReported) {
      await this.db.maintenanceLog.create({
        data: {
          equipmentId: assignment.equipmentId,
          type: "repair",
          description: `Damage reported: ${damageDescription}`,
          performedBy: "Pending",
          notes: `Reported during check-in by user ${assignment.userId}`,
        },
      });
      await this.notificationService.notifyMaintenanceTeam({
        equipmentId: assignment.equipmentId,
        equipmentName: assignment.equipment.name,
        issue: damageDescription || "Damage reported",
        reportedBy: assignment.userId,
      });
    }
    return updatedAssignment;
  }
  async checkEquipmentAvailability(
    equipmentIds,
    startDate,
    endDate,
    excludeBookingId,
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
                OR: [{ checkedInAt: null }, { checkedInAt: { gt: startDate } }],
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
          isAvailable:
            conflicts.length === 0 && equipment?.status === "AVAILABLE",
          conflicts,
        };
      }),
    );
    return availability;
  }
  async logMaintenance(equipmentId, data, userId) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new Error("Equipment not found");
    }
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
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: {
        lastMaintenanceDate: new Date(),
        nextMaintenanceDate: data.nextDueDate,
        status: "AVAILABLE",
      },
    });
    if (data.nextDueDate) {
      const reminderDate = (0, dayjs_1.default)(data.nextDueDate)
        .subtract(7, "days")
        .toDate();
      await this.notificationService.scheduleMaintenanceReminder({
        equipmentId,
        equipmentName: equipment.name,
        dueDate: data.nextDueDate,
        reminderDate,
      });
    }
    await this.auditService.log({
      studioId: equipment.studioId,
      userId,
      action: "EQUIPMENT_MAINTENANCE_LOGGED",
      entity: "Equipment",
      entityId: equipmentId,
      metadata: {
        maintenanceType: data.type,
        cost: data.cost,
      },
    });
    return maintenanceLog;
  }
  async getMaintenanceSchedule(studioId, daysAhead = 30) {
    const cutoffDate = (0, dayjs_1.default)().add(daysAhead, "days").toDate();
    const equipment = await this.db.equipment.findMany({
      where: {
        studioId,
        deletedAt: null,
        status: { not: "RETIRED" },
        OR: [
          { nextMaintenanceDate: { lte: cutoffDate } },
          { nextMaintenanceDate: null },
        ],
      },
      include: {
        maintenanceLogs: {
          orderBy: { performedAt: "desc" },
          take: 1,
        },
      },
    });
    return equipment
      .map((eq) => {
        const lastMaintenance = eq.maintenanceLogs[0];
        const nextDue =
          eq.nextMaintenanceDate || this.calculateNextMaintenanceDate(eq);
        const daysUntilDue = (0, dayjs_1.default)(nextDue).diff(
          (0, dayjs_1.default)(),
          "days",
        );
        return {
          equipmentId: eq.id,
          equipment: eq,
          lastMaintenance: lastMaintenance?.performedAt,
          nextDue,
          daysUntilDue,
          isOverdue: daysUntilDue < 0,
          maintenanceType: this.getMaintenanceType(eq.category),
        };
      })
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }
  async getEquipmentStats(studioId) {
    const [
      totalEquipment,
      statusCounts,
      categoryBreakdown,
      valueData,
      utilizationData,
      maintenanceData,
      ageData,
    ] = await Promise.all([
      this.db.equipment.count({
        where: { studioId, deletedAt: null },
      }),
      this.db.equipment.groupBy({
        by: ["status"],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      this.db.equipment.groupBy({
        by: ["category"],
        where: { studioId, deletedAt: null },
        _count: true,
      }),
      this.db.equipment.aggregate({
        where: { studioId, deletedAt: null },
        _sum: { currentValue: true },
      }),
      this.db.$queryRaw`
        SELECT 
          e.id,
          e."totalHoursUsed",
          EXTRACT(EPOCH FROM (NOW() - e."purchaseDate")) / 3600 as total_hours_owned
        FROM "Equipment" e
        WHERE e."studioId" = ${studioId}
          AND e."deletedAt" IS NULL
          AND e."purchaseDate" IS NOT NULL
      `,
      this.db.equipment.count({
        where: {
          studioId,
          deletedAt: null,
          nextMaintenanceDate: { lte: new Date() },
        },
      }),
      this.db.$queryRaw`
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
    const statusBreakdown = {};
    statusCounts.forEach((item) => {
      statusBreakdown[item.status] = item._count;
    });
    const categoryMap = {};
    categoryBreakdown.forEach((item) => {
      categoryMap[item.category] = item._count;
    });
    const totalUtilization = utilizationData.reduce((sum, eq) => {
      const utilization =
        eq.total_hours_owned > 0
          ? (Number(eq.totalHoursUsed) / eq.total_hours_owned) * 100
          : 0;
      return sum + utilization;
    }, 0);
    const utilizationRate =
      utilizationData.length > 0
        ? totalUtilization / utilizationData.length
        : 0;
    const maintenanceCompliance =
      totalEquipment > 0
        ? ((totalEquipment - maintenanceData) / totalEquipment) * 100
        : 100;
    return {
      totalEquipment,
      availableEquipment: statusBreakdown["AVAILABLE"] || 0,
      inUseEquipment: statusBreakdown["IN_USE"] || 0,
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
  calculateDepreciation(equipment) {
    if (!equipment.purchaseDate || !equipment.purchasePrice) {
      return {
        currentValue: Number(equipment.currentValue || 0),
        totalDepreciation: 0,
        annualDepreciation: 0,
        depreciationRate: 0,
      };
    }
    const yearsOwned = (0, dayjs_1.default)().diff(
      equipment.purchaseDate,
      "years",
      true,
    );
    const depreciationRate = this.getDepreciationRate(equipment.category);
    const annualDepreciation =
      Number(equipment.purchasePrice) * depreciationRate;
    const totalDepreciation = annualDepreciation * yearsOwned;
    const currentValue = Math.max(
      Number(equipment.purchasePrice) - totalDepreciation,
      Number(equipment.purchasePrice) * 0.1,
    );
    return {
      currentValue: Math.round(currentValue * 100) / 100,
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
      annualDepreciation: Math.round(annualDepreciation * 100) / 100,
      depreciationRate: depreciationRate * 100,
      yearsOwned: Math.round(yearsOwned * 10) / 10,
    };
  }
  async getEquipmentUtilization(equipmentId) {
    const thirtyDaysAgo = (0, dayjs_1.default)().subtract(30, "days").toDate();
    const ninetyDaysAgo = (0, dayjs_1.default)().subtract(90, "days").toDate();
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
  async generateUniqueBarcode(studioId) {
    let barcode;
    let exists = true;
    while (exists) {
      barcode = `EQ${studioId.slice(-4)}${Date.now().toString(36).toUpperCase()}`;
      exists =
        (await this.db.equipment.findUnique({
          where: { barcode },
        })) !== null;
    }
    return barcode;
  }
  async handleStatusChange(equipment, oldStatus, userId) {
    if (equipment.status === "MAINTENANCE" && oldStatus !== "MAINTENANCE") {
      await this.notificationService.notifyMaintenanceTeam({
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        issue: "Equipment moved to maintenance status",
        reportedBy: userId,
      });
    }
    if (equipment.status === "RETIRED" && oldStatus !== "RETIRED") {
      await this.db.equipment.update({
        where: { id: equipment.id },
        data: { currentValue: 0 },
      });
    }
  }
  async scheduleNextMaintenance(equipmentId) {
    const equipment = await this.db.equipment.findUnique({
      where: { id: equipmentId },
    });
    if (!equipment) return;
    const interval = this.getMaintenanceInterval(equipment.category);
    if (!interval) return;
    const nextDate = (0, dayjs_1.default)().add(interval, "days").toDate();
    await this.db.equipment.update({
      where: { id: equipmentId },
      data: { nextMaintenanceDate: nextDate },
    });
  }
  getMaintenanceInterval(category) {
    const intervals = {
      Camera: 180,
      Lens: 365,
      Lighting: 90,
      Audio: 180,
      Tripod: 365,
      Computer: 90,
      Drone: 60,
    };
    return intervals[category] || null;
  }
  getDepreciationRate(category) {
    const rates = {
      Camera: 0.2,
      Lens: 0.15,
      Lighting: 0.25,
      Audio: 0.2,
      Computer: 0.33,
      Drone: 0.3,
      Default: 0.2,
    };
    return rates[category] || rates.Default;
  }
  getMaintenanceType(category) {
    const types = {
      Camera: "Sensor cleaning and calibration",
      Lens: "Cleaning and calibration",
      Lighting: "Bulb check and electrical testing",
      Audio: "Connection testing and cleaning",
      Computer: "Software updates and cleaning",
      Drone: "Motor and battery check",
    };
    return types[category] || "General maintenance";
  }
  calculateNextMaintenanceDate(equipment) {
    const interval = this.getMaintenanceInterval(equipment.category) || 180;
    const baseDate =
      equipment.lastMaintenanceDate ||
      equipment.purchaseDate ||
      equipment.createdAt;
    return (0, dayjs_1.default)(baseDate).add(interval, "days").toDate();
  }
  async batchUpdateEquipment(equipmentIds, studioId, updates, userId) {
    const equipment = await this.db.equipment.findMany({
      where: {
        id: { in: equipmentIds },
        studioId,
        deletedAt: null,
      },
    });
    if (equipment.length !== equipmentIds.length) {
      throw new Error("Some equipment not found or not accessible");
    }
    const result = await this.db.equipment.updateMany({
      where: {
        id: { in: equipmentIds },
      },
      data: updates,
    });
    await this.auditService.log({
      studioId,
      userId,
      action: "EQUIPMENT_BATCH_UPDATE",
      entity: "Equipment",
      metadata: {
        count: result.count,
        updates,
      },
    });
    return result;
  }
  async getEquipmentTemplates(category) {
    const templates = [
      {
        category: "Camera",
        templates: [
          {
            name: "Canon EOS R5",
            brand: "Canon",
            model: "EOS R5",
            subcategory: "Mirrorless",
            specifications: {
              sensor: "Full-frame 45MP",
              video: "8K RAW",
              stabilization: "IBIS",
            },
          },
          {
            name: "Sony A7R V",
            brand: "Sony",
            model: "A7R V",
            subcategory: "Mirrorless",
            specifications: {
              sensor: "Full-frame 61MP",
              video: "8K",
              stabilization: "IBIS",
            },
          },
        ],
      },
      {
        category: "Lens",
        templates: [
          {
            name: "Canon RF 24-70mm f/2.8L",
            brand: "Canon",
            model: "RF 24-70mm f/2.8L IS USM",
            subcategory: "Zoom",
            specifications: {
              focalLength: "24-70mm",
              aperture: "f/2.8",
              stabilization: "IS",
            },
          },
          {
            name: "Sony FE 85mm f/1.4 GM",
            brand: "Sony",
            model: "FE 85mm f/1.4 GM",
            subcategory: "Prime",
            specifications: {
              focalLength: "85mm",
              aperture: "f/1.4",
              type: "Portrait",
            },
          },
        ],
      },
      {
        category: "Lighting",
        templates: [
          {
            name: "Profoto B10X",
            brand: "Profoto",
            model: "B10X",
            subcategory: "Strobe",
            specifications: {
              power: "250Ws",
              battery: "Built-in",
              ttl: "Yes",
            },
          },
          {
            name: "Aputure 600d Pro",
            brand: "Aputure",
            model: "600d Pro",
            subcategory: "LED",
            specifications: {
              power: "600W",
              colorTemp: "5600K",
              wireless: "Yes",
            },
          },
        ],
      },
    ];
    if (category) {
      return templates.find((t) => t.category === category)?.templates || [];
    }
    return templates;
  }
}
exports.EquipmentService = EquipmentService;
