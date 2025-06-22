import { Equipment, EquipmentStatus, Prisma } from '@prisma/client';
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
    ageDistribution: Array<{
        range: string;
        count: number;
    }>;
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
export declare class EquipmentService {
    private static instance;
    private db;
    private logger;
    private auditService;
    private notificationService;
    private qrCodeService;
    private fileService;
    private constructor();
    static getInstance(): EquipmentService;
    getEquipment(studioId: string, filters: EquipmentFilters, page?: number, limit?: number): Promise<{
        equipment: any;
        pagination: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    getEquipmentById(equipmentId: string, studioId: string): Promise<any>;
    createEquipment(data: Prisma.EquipmentCreateInput, userId: string, imageFile?: Express.Multer.File): Promise<any>;
    updateEquipment(equipmentId: string, studioId: string, data: Prisma.EquipmentUpdateInput, userId: string): Promise<any>;
    deleteEquipment(equipmentId: string, studioId: string, userId: string): Promise<{
        success: boolean;
    }>;
    checkOutEquipment(equipmentId: string, userId: string, bookingId: string | null, expectedReturnAt: Date, notes?: string): Promise<any>;
    checkInEquipment(assignmentId: string, condition: string, notes?: string, damageReported?: boolean, damageDescription?: string): Promise<any>;
    checkEquipmentAvailability(equipmentIds: string[], startDate: Date, endDate: Date, excludeBookingId?: string): Promise<{
        equipmentId: string;
        equipment: any;
        isAvailable: boolean;
        conflicts: any;
    }[]>;
    logMaintenance(equipmentId: string, data: {
        type: string;
        description: string;
        performedBy: string;
        cost?: number;
        nextDueDate?: Date;
        partsReplaced?: string[];
        notes?: string;
    }, userId: string): Promise<any>;
    getMaintenanceSchedule(studioId: string, daysAhead?: number): Promise<MaintenanceSchedule[]>;
    getEquipmentStats(studioId: string): Promise<EquipmentStats>;
    private calculateDepreciation;
    private getEquipmentUtilization;
    private generateUniqueBarcode;
    private handleStatusChange;
    private scheduleNextMaintenance;
    private getMaintenanceInterval;
    private getDepreciationRate;
    private getMaintenanceType;
    private calculateNextMaintenanceDate;
    batchUpdateEquipment(equipmentIds: string[], studioId: string, updates: Prisma.EquipmentUpdateInput, userId: string): Promise<any>;
    getEquipmentTemplates(category?: string): Promise<{
        name: string;
        brand: string;
        model: string;
        subcategory: string;
        specifications: {
            sensor: string;
            video: string;
            stabilization: string;
        };
    }[] | ({
        name: string;
        brand: string;
        model: string;
        subcategory: string;
        specifications: {
            focalLength: string;
            aperture: string;
            stabilization: string;
            type?: undefined;
        };
    } | {
        name: string;
        brand: string;
        model: string;
        subcategory: string;
        specifications: {
            focalLength: string;
            aperture: string;
            type: string;
            stabilization?: undefined;
        };
    })[] | ({
        name: string;
        brand: string;
        model: string;
        subcategory: string;
        specifications: {
            power: string;
            battery: string;
            ttl: string;
            colorTemp?: undefined;
            wireless?: undefined;
        };
    } | {
        name: string;
        brand: string;
        model: string;
        subcategory: string;
        specifications: {
            power: string;
            colorTemp: string;
            wireless: string;
            battery?: undefined;
            ttl?: undefined;
        };
    })[] | ({
        category: string;
        templates: {
            name: string;
            brand: string;
            model: string;
            subcategory: string;
            specifications: {
                sensor: string;
                video: string;
                stabilization: string;
            };
        }[];
    } | {
        category: string;
        templates: ({
            name: string;
            brand: string;
            model: string;
            subcategory: string;
            specifications: {
                focalLength: string;
                aperture: string;
                stabilization: string;
                type?: undefined;
            };
        } | {
            name: string;
            brand: string;
            model: string;
            subcategory: string;
            specifications: {
                focalLength: string;
                aperture: string;
                type: string;
                stabilization?: undefined;
            };
        })[];
    } | {
        category: string;
        templates: ({
            name: string;
            brand: string;
            model: string;
            subcategory: string;
            specifications: {
                power: string;
                battery: string;
                ttl: string;
                colorTemp?: undefined;
                wireless?: undefined;
            };
        } | {
            name: string;
            brand: string;
            model: string;
            subcategory: string;
            specifications: {
                power: string;
                colorTemp: string;
                wireless: string;
                battery?: undefined;
                ttl?: undefined;
            };
        })[];
    })[]>;
}
export {};
