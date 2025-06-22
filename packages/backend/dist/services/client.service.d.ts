import { Prisma } from "@prisma/client";
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
  monthlyGrowth: Array<{
    month: string;
    count: number;
    revenue: number;
  }>;
}
export declare class ClientService {
  private static instance;
  private db;
  private emailService;
  private logger;
  private auditService;
  private cache;
  private constructor();
  static getInstance(): ClientService;
  getClients(
    studioId: string,
    filters: ClientFilters,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: "asc" | "desc",
  ): Promise<{
    clients: any;
    pagination: {
      total: any;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>;
  getClientById(clientId: string, studioId: string): Promise<any>;
  createClient(data: Prisma.ClientCreateInput, userId: string): Promise<any>;
  updateClient(
    clientId: string,
    studioId: string,
    data: Prisma.ClientUpdateInput,
    userId: string,
  ): Promise<any>;
  deleteClient(
    clientId: string,
    studioId: string,
    userId: string,
  ): Promise<{
    success: boolean;
  }>;
  private getClientStats;
  getClientCommunication(
    clientId: string,
    studioId: string,
  ): Promise<{
    emails: any;
    notifications: any;
  }>;
  mergeClients(
    primaryClientId: string,
    secondaryClientId: string,
    studioId: string,
    userId: string,
  ): Promise<any>;
  setupPortalAccess(
    clientId: string,
    studioId: string,
    password: string,
    userId: string,
  ): Promise<any>;
  calculateLoyaltyRewards(
    clientId: string,
    studioId: string,
  ): Promise<
    | {
        points: any;
        rewards: never[];
        nextRewardPoints?: undefined;
        availableRewards?: undefined;
      }
    | {
        points: any;
        nextRewardPoints: any;
        availableRewards: any;
        rewards?: undefined;
      }
  >;
  exportClients(
    studioId: string,
    filters: ClientFilters,
    format: "csv" | "excel",
  ): Promise<string | Buffer<ArrayBufferLike>>;
  getClientInsights(studioId: string): Promise<ClientStats>;
  private generateUnsubscribeToken;
  private buildWhereClause;
  private exportToCSV;
  private exportToExcel;
}
export {};
