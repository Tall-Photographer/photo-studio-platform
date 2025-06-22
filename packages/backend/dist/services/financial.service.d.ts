import { InvoiceStatus } from "@prisma/client";
interface InvoiceFilters {
  search?: string;
  status?: InvoiceStatus;
  clientId?: string;
  bookingId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  overdue?: boolean;
}
export declare class FinancialService {
  private static instance;
  private db;
  private emailService;
  private logger;
  private auditService;
  private notificationService;
  private pdfService;
  private accountingService;
  private stripe;
  private constructor();
  static getInstance(): FinancialService;
  getInvoices(
    studioId: string,
    filters: InvoiceFilters,
    page?: number,
    limit?: number,
  ): Promise<{
    invoices: any;
    pagination: {
      total: any;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>;
  getInvoiceById(invoiceId: string, studioId: string): Promise<any>;
  createInvoice(data: {
    clientId: string;
    bookingId?: string;
    issueDate?: Date;
    dueDate: Date;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      taxable?: boolean;
      category?: string;
    }>;
    discountPercentage?: number;
    discountAmount: number;
    taxRate: number;
    paymentTerms: string;
    notes: string;
    status: InvoiceStatus;
  }): any;
}
export {};
