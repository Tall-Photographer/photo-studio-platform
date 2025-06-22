import { PrismaClient } from '@prisma/client';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class DatabaseService {
    private static instance;
    private prisma;
    private supabase;
    private logger;
    private isConnected;
    private constructor();
    static getInstance(): DatabaseService;
    private setupEventHandlers;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getClient(): PrismaClient;
    getSupabase(): SupabaseClient;
    healthCheck(): Promise<boolean>;
    transaction<T>(callback: (prisma: PrismaClient) => Promise<T>): Promise<T>;
    findUserByEmail(email: string): Promise<any>;
    findUserById(id: string): Promise<any>;
    createUser(data: any): Promise<any>;
    updateUser(id: string, data: any): Promise<any>;
    createStudio(data: any): Promise<any>;
    findStudioBySlug(slug: string): Promise<any>;
    findStudioById(id: string): Promise<any>;
    createBooking(data: any): Promise<any>;
    findBookingsByStudio(studioId: string, filters?: any): Promise<any>;
    createClient(data: any): Promise<any>;
    findClientsByStudio(studioId: string, filters?: any): Promise<any>;
    findEquipmentByStudio(studioId: string, filters?: any): Promise<any>;
    findProjectsByStudio(studioId: string, filters?: any): Promise<any>;
    findInvoicesByStudio(studioId: string, filters?: any): Promise<any>;
    getDashboardStats(studioId: string): Promise<{
        totalClients: any;
        totalBookings: any;
        activeProjects: any;
        pendingInvoices: any;
        monthlyRevenue: any;
        equipmentInUse: any;
        recentBookings: any;
        recentProjects: any;
        generatedAt: string;
    }>;
    uploadFile(bucketName: string, filePath: string, file: Buffer | Uint8Array | File, options?: {
        contentType?: string;
        metadata?: Record<string, string>;
    }): Promise<{
        id: string;
        path: string;
        fullPath: string;
    }>;
    getFileUrl(bucketName: string, filePath: string): Promise<string>;
    deleteFile(bucketName: string, filePath: string): Promise<boolean>;
    createAuditLog(data: {
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
    }): Promise<any>;
    generateUniqueNumber(entity: 'booking' | 'invoice' | 'payment' | 'project', studioId: string, prefix?: string): Promise<string>;
}
