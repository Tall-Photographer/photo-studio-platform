// packages/backend/src/services/financial.service.ts
import { 
  Invoice, 
  Payment, 
  InvoiceStatus, 
  PaymentStatus, 
  PaymentGateway,
  Currency,
  Prisma
} from '@prisma/client';
import Stripe from 'stripe';
import * as paypal from 'paypal-rest-sdk';
import { DatabaseService } from './database.service';
import { EmailService } from './email.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { PDFService } from './pdf.service';
import { AccountingService } from './accounting.service';
import dayjs from 'dayjs';

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

interface PaymentFilters {
  clientId?: string;
  invoiceId?: string;
  status?: PaymentStatus;
  gateway?: PaymentGateway;
  startDate?: Date;
  endDate?: Date;
}

interface FinancialSummary {
  totalRevenue: number;
  totalOutstanding: number;
  totalOverdue: number;
  averagePaymentTime: number;
  revenueByMonth: Array<{ month: string; amount: number }>;
  revenueByService: Record<string, number>;
  topClients: Array<{ client: any; totalSpent: number }>;
  paymentMethodBreakdown: Record<string, number>;
}

interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export class FinancialService {
  private static instance: FinancialService;
  private db = DatabaseService.getInstance().getClient();
  private emailService = EmailService.getInstance();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();
  private notificationService = NotificationService.getInstance();
  private pdfService = PDFService.getInstance();
  private accountingService = AccountingService.getInstance();
  private stripe: Stripe;
  
  private constructor() {
    // Initialize Stripe
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });

    // Initialize PayPal
    paypal.configure({
      mode: process.env.PAYPAL_MODE || 'sandbox',
      client_id: process.env.PAYPAL_CLIENT_ID!,
      client_secret: process.env.PAYPAL_CLIENT_SECRET!,
    });
  }

  public static getInstance(): FinancialService {
    if (!FinancialService.instance) {
      FinancialService.instance = new FinancialService();
    }
    return FinancialService.instance;
  }

  // Invoice Management
  public async getInvoices(
    studioId: string,
    filters: InvoiceFilters,
    page: number = 1,
    limit: number = 20
  ) {
    const where: Prisma.InvoiceWhereInput = {
      studioId,
    };

    // Apply filters
    if (filters.search) {
      where.OR = [
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { client: { firstName: { contains: filters.search, mode: 'insensitive' } } },
        { client: { lastName: { contains: filters.search, mode: 'insensitive' } } },
        { client: { email: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    if (filters.bookingId) {
      where.bookingId = filters.bookingId;
    }

    if (filters.startDate || filters.endDate) {
      where.issueDate = {
        gte: filters.startDate,
        lte: filters.endDate,
      };
    }

    if (filters.minAmount !== undefined) {
      where.total = { gte: filters.minAmount };
    }

    if (filters.maxAmount !== undefined) {
      where.total = { ...where.total, lte: filters.maxAmount };
    }

    if (filters.overdue) {
      where.AND = [
        { status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] } },
        { dueDate: { lt: new Date() } },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.db.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          client: true,
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              title: true,
            },
          },
          lineItems: true,
          payments: {
            where: { status: 'COMPLETED' },
          },
        },
        orderBy: { issueDate: 'desc' },
      }),
      this.db.invoice.count({ where }),
    ]);

    return {
      invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get invoice by ID
  public async getInvoiceById(invoiceId: string, studioId: string) {
    const invoice = await this.db.invoice.findFirst({
      where: {
        id: invoiceId,
        studioId,
      },
      include: {
        client: true,
        booking: {
          include: {
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
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        studio: true,
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    return invoice;
  }

  // Create invoice
  public async createInvoice(
    data: {
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
    }>,
    userId: string
  ) {
    const invoice = await this.getInvoiceById(invoiceId, studioId);

    if (invoice.status === 'PAID') {
      throw new Error('Cannot update paid invoice');
    }

    const oldValues = { ...invoice };

    // Update line items if provided
    if (data.lineItems) {
      // Delete existing line items
      await this.db.invoiceLineItem.deleteMany({
        where: { invoiceId },
      });

      // Create new line items
      const lineItems = await this.db.invoiceLineItem.createMany({
        data: data.lineItems.map((item, index) => ({
          invoiceId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          taxable: item.taxable !== false,
          taxRate: invoice.taxRate,
          taxAmount: item.taxable !== false
            ? (item.quantity * item.unitPrice * Number(invoice.taxRate)) / 100
            : 0,
          category: item.category,
          sortOrder: index,
        })),
      });
    }

    // Recalculate totals
    await DatabaseService.getInstance().recalculateInvoiceTotals(invoiceId);

    // Update invoice
    const updated = await this.db.invoice.update({
      where: { id: invoiceId },
      data: {
        dueDate: data.dueDate,
        discountPercentage: data.discountPercentage,
        discountAmount: data.discountAmount,
        taxRate: data.taxRate,
        paymentTerms: data.paymentTerms,
        notes: data.notes,
        status: data.status,
      },
      include: {
        client: true,
        lineItems: true,
      },
    });

    // Send email if status changed to SENT
    if (oldValues.status !== 'SENT' && updated.status === 'SENT') {
      await this.sendInvoiceEmail(updated.id);
    }

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'INVOICE_UPDATED',
      entity: 'Invoice',
      entityId: invoiceId,
      oldValues,
      newValues: updated,
    });

    return updated;
  }

  // Send invoice email
  public async sendInvoiceEmail(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        studio: true,
        lineItems: true,
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Generate PDF
    const pdf = await this.pdfService.generateInvoicePDF(invoice);

    // Send email
    await this.emailService.sendInvoiceEmail(
      invoice.client.email,
      invoice.client.firstName,
      invoice.invoiceNumber,
      invoice.total,
      invoice.currency,
      invoice.dueDate,
      pdf
    );

    // Update invoice status
    await this.db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    // Schedule reminder for due date
    const reminderDate = dayjs(invoice.dueDate).subtract(3, 'days').toDate();
    if (reminderDate > new Date()) {
      await this.notificationService.scheduleInvoiceReminder({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        clientEmail: invoice.client.email,
        reminderDate,
      });
    }

    return { success: true };
  }

  // Payment Processing
  public async createPaymentIntent(
    data: {
      amount: number;
      currency: Currency;
      clientId: string;
      invoiceId?: string;
      bookingId?: string;
      gateway: PaymentGateway;
      metadata?: Record<string, any>;
    },
    studioId: string
  ): Promise<PaymentIntent> {
    // Get studio payment gateway settings
    const gatewaySettings = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: `${data.gateway.toLowerCase()}_settings`,
        category: 'payment',
      },
    });

    if (!gatewaySettings) {
      throw new Error(`${data.gateway} not configured for this studio`);
    }

    switch (data.gateway) {
      case 'STRIPE':
        return this.createStripePaymentIntent(data, gatewaySettings.value as any);
      case 'PAYPAL':
        return this.createPayPalPayment(data, gatewaySettings.value as any);
      default:
        throw new Error(`Unsupported payment gateway: ${data.gateway}`);
    }
  }

  // Create Stripe payment intent
  private async createStripePaymentIntent(
    data: any,
    settings: any
  ): Promise<PaymentIntent> {
    const client = await this.db.client.findUnique({
      where: { id: data.clientId },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    // Create or get Stripe customer
    let stripeCustomerId = client.metadata?.stripeCustomerId as string;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: client.email,
        name: `${client.firstName} ${client.lastName}`,
        metadata: {
          clientId: client.id,
          studioId: client.studioId,
        },
      });
      stripeCustomerId = customer.id;

      // Save Stripe customer ID
      await this.db.client.update({
        where: { id: client.id },
        data: {
          metadata: {
            ...((client.metadata as any) || {}),
            stripeCustomerId,
          },
        },
      });
    }

    // Create payment intent
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(data.amount * 100), // Convert to cents
      currency: data.currency.toLowerCase(),
      customer: stripeCustomerId,
      metadata: {
        ...data.metadata,
        clientId: data.clientId,
        invoiceId: data.invoiceId || '',
        bookingId: data.bookingId || '',
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      amount: data.amount,
      currency: data.currency,
      status: paymentIntent.status,
    };
  }

  // Create PayPal payment
  private async createPayPalPayment(
    data: any,
    settings: any
  ): Promise<PaymentIntent> {
    const createPaymentJson = {
      intent: 'sale',
      payer: {
        payment_method: 'paypal',
      },
      redirect_urls: {
        return_url: `${process.env.APP_URL}/payments/success`,
        cancel_url: `${process.env.APP_URL}/payments/cancel`,
      },
      transactions: [{
        amount: {
          currency: data.currency,
          total: data.amount.toFixed(2),
        },
        description: data.metadata?.description || 'Payment',
        custom: JSON.stringify({
          clientId: data.clientId,
          invoiceId: data.invoiceId,
          bookingId: data.bookingId,
        }),
      }],
    };

    return new Promise((resolve, reject) => {
      paypal.payment.create(createPaymentJson, (error, payment) => {
        if (error) {
          reject(error);
        } else {
          const approvalUrl = payment.links?.find(link => link.rel === 'approval_url')?.href;
          resolve({
            id: payment.id!,
            clientSecret: approvalUrl || '',
            amount: data.amount,
            currency: data.currency,
            status: payment.state || 'created',
          });
        }
      });
    });
  }

  // Process payment
  public async processPayment(
    paymentIntentId: string,
    gateway: PaymentGateway,
    studioId: string,
    userId: string
  ) {
    let paymentData: any;

    switch (gateway) {
      case 'STRIPE':
        const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
        paymentData = {
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: paymentIntent.status === 'succeeded' ? 'COMPLETED' : 'FAILED',
          gatewayTransactionId: paymentIntent.id,
          gatewayResponse: paymentIntent,
          clientId: paymentIntent.metadata.clientId,
          invoiceId: paymentIntent.metadata.invoiceId || null,
          bookingId: paymentIntent.metadata.bookingId || null,
        };
        break;
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }

    // Create payment record
    const payment = await this.db.payment.create({
      data: {
        studioId,
        clientId: paymentData.clientId,
        invoiceId: paymentData.invoiceId,
        bookingId: paymentData.bookingId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        gateway,
        gatewayTransactionId: paymentData.gatewayTransactionId,
        gatewayResponse: paymentData.gatewayResponse,
        status: paymentData.status,
        processedAt: paymentData.status === 'COMPLETED' ? new Date() : null,
      },
    });

    // Update invoice if payment is for an invoice
    if (payment.invoiceId && payment.status === 'COMPLETED') {
      await this.applyPaymentToInvoice(payment.id, payment.invoiceId);
    }

    // Update client statistics
    await DatabaseService.getInstance().updateClientStatistics(payment.clientId);

    // Send confirmation email
    if (payment.status === 'COMPLETED') {
      const client = await this.db.client.findUnique({
        where: { id: payment.clientId },
      });

      if (client) {
        await this.emailService.sendPaymentConfirmation(
          client.email,
          client.firstName,
          payment.paymentNumber,
          payment.amount,
          payment.currency
        );
      }
    }

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'PAYMENT_PROCESSED',
      entity: 'Payment',
      entityId: payment.id,
      metadata: {
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        gateway,
      },
    });

    return payment;
  }

  // Apply payment to invoice
  private async applyPaymentToInvoice(paymentId: string, invoiceId: string) {
    const [payment, invoice] = await Promise.all([
      this.db.payment.findUnique({ where: { id: paymentId } }),
      this.db.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: { where: { status: 'COMPLETED' } } },
      }),
    ]);

    if (!payment || !invoice) {
      throw new Error('Payment or invoice not found');
    }

    // Calculate total paid
    const totalPaid = invoice.payments.reduce((sum, p) => {
      return sum + Number(p.amount);
    }, 0);

    const amountDue = Number(invoice.total) - totalPaid;

    // Update invoice
    await this.db.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: totalPaid,
        amountDue,
        status: amountDue <= 0 ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: amountDue <= 0 ? new Date() : null,
      },
    });

    // If invoice is for a booking, update booking status
    if (invoice.bookingId) {
      await this.db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
    }

    // Sync with accounting system
    await this.accountingService.syncPayment(payment);
  }

  // Get payments
  public async getPayments(
    studioId: string,
    filters: PaymentFilters,
    page: number = 1,
    limit: number = 20
  ) {
    const where: Prisma.PaymentWhereInput = {
      studioId,
    };

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    if (filters.invoiceId) {
      where.invoiceId = filters.invoiceId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.gateway) {
      where.gateway = filters.gateway;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        gte: filters.startDate,
        lte: filters.endDate,
      };
    }

    const [payments, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          client: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
            },
          },
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.payment.count({ where }),
    ]);

    return {
      payments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Process refund
  public async processRefund(
    paymentId: string,
    amount: number,
    reason: string,
    studioId: string,
    userId: string
  ) {
    const payment = await this.db.payment.findFirst({
      where: {
        id: paymentId,
        studioId,
        status: 'COMPLETED',
      },
    });

    if (!payment) {
      throw new Error('Payment not found or not completed');
    }

    if (amount > Number(payment.amount) - Number(payment.refundAmount)) {
      throw new Error('Refund amount exceeds available amount');
    }

    let refundResult: any;

    // Process refund with gateway
    switch (payment.gateway) {
      case 'STRIPE':
        const refund = await this.stripe.refunds.create({
          payment_intent: payment.gatewayTransactionId!,
          amount: Math.round(amount * 100),
          reason: 'requested_by_customer',
          metadata: {
            internalReason: reason,
            refundedBy: userId,
          },
        });
        refundResult = refund;
        break;
      default:
        throw new Error(`Refunds not supported for ${payment.gateway}`);
    }

    // Update payment record
    const updated = await this.db.payment.update({
      where: { id: paymentId },
      data: {
        refundAmount: { increment: amount },
        refundedAt: new Date(),
        refundReason: reason,
        status: Number(payment.amount) - Number(payment.refundAmount) - amount <= 0 
          ? 'REFUNDED' 
          : payment.status,
      },
    });

    // Update invoice if applicable
    if (payment.invoiceId) {
      const invoice = await this.db.invoice.findUnique({
        where: { id: payment.invoiceId },
      });

      if (invoice) {
        await this.db.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            amountPaid: { decrement: amount },
            amountDue: { increment: amount },
            status: 'PARTIALLY_PAID',
          },
        });
      }
    }

    // Send refund confirmation
    const client = await this.db.client.findUnique({
      where: { id: payment.clientId },
    });

    if (client) {
      await this.emailService.sendRefundConfirmation(
        client.email,
        client.firstName,
        payment.paymentNumber,
        amount,
        payment.currency,
        reason
      );
    }

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'PAYMENT_REFUNDED',
      entity: 'Payment',
      entityId: paymentId,
      metadata: {
        amount,
        reason,
        refundId: refundResult.id,
      },
    });

    return updated;
  }

  // Financial summary and reports
  public async getFinancialSummary(
    studioId: string,
    startDate: Date,
    endDate: Date
  ): Promise<FinancialSummary> {
    const [
      revenueData,
      outstandingData,
      overdueData,
      paymentTimeData,
      monthlyRevenue,
      serviceRevenue,
      topClients,
      paymentMethods,
    ] = await Promise.all([
      // Total revenue
      this.db.payment.aggregate({
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      // Outstanding invoices
      this.db.invoice.aggregate({
        where: {
          studioId,
          status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
        },
        _sum: { amountDue: true },
      }),
      // Overdue invoices
      this.db.invoice.aggregate({
        where: {
          studioId,
          status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
        _sum: { amountDue: true },
      }),
      // Average payment time
      this.db.$queryRaw<any[]>`
        SELECT AVG(EXTRACT(DAY FROM (i."paidAt" - i."issueDate"))) as avg_days
        FROM "Invoice" i
        WHERE i."studioId" = ${studioId}
          AND i.status = 'PAID'
          AND i."paidAt" IS NOT NULL
          AND i."issueDate" >= ${startDate}
          AND i."issueDate" <= ${endDate}
      `,
      // Revenue by month
      this.db.$queryRaw<any[]>`
        SELECT 
          DATE_TRUNC('month', p."processedAt") as month,
          SUM(p.amount) as amount
        FROM "Payment" p
        WHERE p."studioId" = ${studioId}
          AND p.status = 'COMPLETED'
          AND p."processedAt" >= ${startDate}
          AND p."processedAt" <= ${endDate}
        GROUP BY DATE_TRUNC('month', p."processedAt")
        ORDER BY month
      `,
      // Revenue by service (from invoice line items)
      this.db.$queryRaw<any[]>`
        SELECT 
          ili.category,
          SUM(ili.total) as amount
        FROM "InvoiceLineItem" ili
        JOIN "Invoice" i ON i.id = ili."invoiceId"
        WHERE i."studioId" = ${studioId}
          AND i.status = 'PAID'
          AND i."paidAt" >= ${startDate}
          AND i."paidAt" <= ${endDate}
          AND ili.category IS NOT NULL
        GROUP BY ili.category
      `,
      // Top clients
      this.db.$queryRaw<any[]>`
        SELECT 
          c.id,
          c."firstName",
          c."lastName",
          c.email,
          c.company,
          SUM(p.amount) as total_spent
        FROM "Client" c
        JOIN "Payment" p ON p."clientId" = c.id
        WHERE p."studioId" = ${studioId}
          AND p.status = 'COMPLETED'
          AND p."processedAt" >= ${startDate}
          AND p."processedAt" <= ${endDate}
        GROUP BY c.id, c."firstName", c."lastName", c.email, c.company
        ORDER BY total_spent DESC
        LIMIT 10
      `,
      // Payment methods breakdown
      this.db.payment.groupBy({
        by: ['gateway'],
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Process results
    const revenueByService: Record<string, number> = {};
    serviceRevenue.forEach((item) => {
      revenueByService[item.category] = Number(item.amount);
    });

    const paymentMethodBreakdown: Record<string, number> = {};
    paymentMethods.forEach((item) => {
      paymentMethodBreakdown[item.gateway] = Number(item._sum.amount || 0);
    });

    return {
      totalRevenue: Number(revenueData._sum.amount || 0),
      totalOutstanding: Number(outstandingData._sum.amountDue || 0),
      totalOverdue: Number(overdueData._sum.amountDue || 0),
      averagePaymentTime: Number(paymentTimeData[0]?.avg_days || 0),
      revenueByMonth: monthlyRevenue.map((item) => ({
        month: dayjs(item.month).format('YYYY-MM'),
        amount: Number(item.amount),
      })),
      revenueByService,
      topClients: topClients.map((item) => ({
        client: {
          id: item.id,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          company: item.company,
        },
        totalSpent: Number(item.total_spent),
      })),
      paymentMethodBreakdown,
    };
  }

  // Generate financial reports
  public async generateFinancialReport(
    studioId: string,
    type: 'income' | 'expenses' | 'profit_loss' | 'tax',
    startDate: Date,
    endDate: Date,
    format: 'pdf' | 'excel' = 'pdf'
  ) {
    const studio = await this.db.studio.findUnique({
      where: { id: studioId },
    });

    if (!studio) {
      throw new Error('Studio not found');
    }

    let reportData: any;

    switch (type) {
      case 'income':
        reportData = await this.generateIncomeReport(studioId, startDate, endDate);
        break;
      case 'expenses':
        reportData = await this.generateExpenseReport(studioId, startDate, endDate);
        break;
      case 'profit_loss':
        reportData = await this.generateProfitLossReport(studioId, startDate, endDate);
        break;
      case 'tax':
        reportData = await this.generateTaxReport(studioId, startDate, endDate);
        break;
    }

    if (format === 'pdf') {
      return this.pdfService.generateFinancialReport(studio, type, reportData, startDate, endDate);
    } else {
      // Excel export would be implemented here
      throw new Error('Excel export not implemented yet');
    }
  }

  // Helper methods for report generation
  private async generateIncomeReport(studioId: string, startDate: Date, endDate: Date) {
    const [payments, invoices] = await Promise.all([
      this.db.payment.findMany({
        where: {
          studioId,
          status: 'COMPLETED',
          processedAt: { gte: startDate, lte: endDate },
        },
        include: {
          client: true,
          invoice: true,
        },
        orderBy: { processedAt: 'asc' },
      }),
      this.db.invoice.findMany({
        where: {
          studioId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endDate },
        },
        include: {
          client: true,
          lineItems: true,
        },
        orderBy: { paidAt: 'asc' },
      }),
    ]);

    return { payments, invoices };
  }

  private async generateExpenseReport(studioId: string, startDate: Date, endDate: Date) {
    const expenses = await this.db.expense.findMany({
      where: {
        studioId,
        expenseDate: { gte: startDate, lte: endDate },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { expenseDate: 'asc' },
    });

    const byCategory = await this.db.expense.groupBy({
      by: ['category'],
      where: {
        studioId,
        expenseDate: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    });

    return { expenses, byCategory };
  }

  private async generateProfitLossReport(studioId: string, startDate: Date, endDate: Date) {
    const [income, expenses] = await Promise.all([
      this.generateIncomeReport(studioId, startDate, endDate),
      this.generateExpenseReport(studioId, startDate, endDate),
    ]);

    const totalIncome = income.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalExpenses = expenses.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const netProfit = totalIncome - totalExpenses;

    return {
      income,
      expenses,
      summary: {
        totalIncome,
        totalExpenses,
        netProfit,
        profitMargin: totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0,
      },
    };
  }

  private async generateTaxReport(studioId: string, startDate: Date, endDate: Date) {
    const [taxCollected, taxableIncome] = await Promise.all([
      this.db.invoice.aggregate({
        where: {
          studioId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endDate },
        },
        _sum: { taxAmount: true },
      }),
      this.db.invoice.aggregate({
        where: {
          studioId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endDate },
        },
        _sum: { subtotal: true, discountAmount: true },
      }),
    ]);

    return {
      taxCollected: Number(taxCollected._sum.taxAmount || 0),
      taxableIncome: Number(taxableIncome._sum.subtotal || 0) - Number(taxableIncome._sum.discountAmount || 0),
      // Additional tax calculations would go here
    };
  }

  // Automated billing
  public async processRecurringInvoices(studioId: string) {
    // Find bookings with recurring patterns that need invoicing
    const recurringBookings = await this.db.booking.findMany({
      where: {
        studioId,
        isRecurring: true,
        status: 'COMPLETED',
        invoice: null,
      },
      include: {
        client: true,
        assignments: true,
      },
    });

    const invoicesCreated = [];

    for (const booking of recurringBookings) {
      try {
        const invoice = await this.createInvoice(
          {
            clientId: booking.clientId,
            bookingId: booking.id,
            dueDate: dayjs().add(30, 'days').toDate(),
            lineItems: [{
              description: booking.title,
              quantity: 1,
              unitPrice: Number(booking.totalAmount),
              category: booking.type,
            }],
            currency: booking.currency,
            paymentTerms: 'Net 30',
          },
          studioId,
          'system'
        );

        invoicesCreated.push(invoice);
      } catch (error) {
        this.logger.error('Failed to create recurring invoice:', error);
      }
    }

    return invoicesCreated;
  }

  // Send payment reminders
  public async sendPaymentReminders(studioId: string) {
    const overdueInvoices = await this.db.invoice.findMany({
      where: {
        studioId,
        status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
        dueDate: { lt: new Date() },
      },
      include: {
        client: true,
      },
    });

    for (const invoice of overdueInvoices) {
      const daysPastDue = dayjs().diff(invoice.dueDate, 'days');

      // Send reminders at 3, 7, 14, and 30 days past due
      if ([3, 7, 14, 30].includes(daysPastDue)) {
        await this.emailService.sendPaymentReminder(
          invoice.client.email,
          invoice.client.firstName,
          invoice.invoiceNumber,
          invoice.amountDue,
          invoice.currency,
          daysPastDue
        );

        // Update invoice status to OVERDUE if not already
        if (invoice.status !== 'OVERDUE') {
          await this.db.invoice.update({
            where: { id: invoice.id },
            data: { status: 'OVERDUE' },
          });
        }
      }
    }
  }
}?: number;
      taxRate?: number;
      currency: Currency;
      paymentTerms?: string;
      notes?: string;
    },
    studioId: string,
    userId: string
  ) {
    // Get studio settings for defaults
    const studio = await this.db.studio.findUnique({
      where: { id: studioId },
    });

    if (!studio) {
      throw new Error('Studio not found');
    }

    // Calculate totals
    const subtotal = data.lineItems.reduce((sum, item) => {
      return sum + (item.quantity * item.unitPrice);
    }, 0);

    const discountAmount = data.discountPercentage
      ? (subtotal * data.discountPercentage) / 100
      : data.discountAmount || 0;

    const taxableAmount = data.lineItems.reduce((sum, item) => {
      if (item.taxable !== false) {
        return sum + (item.quantity * item.unitPrice);
      }
      return sum;
    }, 0) - discountAmount;

    const taxRate = data.taxRate ?? Number(studio.taxRate);
    const taxAmount = (taxableAmount * taxRate) / 100;
    const total = subtotal - discountAmount + taxAmount;

    // Create invoice with line items
    const invoice = await this.db.invoice.create({
      data: {
        studioId,
        clientId: data.clientId,
        bookingId: data.bookingId,
        createdById: userId,
        issueDate: data.issueDate || new Date(),
        dueDate: data.dueDate,
        status: 'DRAFT',
        subtotal,
        discountPercentage: data.discountPercentage || 0,
        discountAmount,
        taxRate,
        taxAmount,
        total,
        amountDue: total,
        currency: data.currency,
        paymentTerms: data.paymentTerms,
        notes: data.notes,
        lineItems: {
          create: data.lineItems.map((item, index) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
            taxable: item.taxable !== false,
            taxRate: item.taxable !== false ? taxRate : 0,
            taxAmount: item.taxable !== false
              ? (item.quantity * item.unitPrice * taxRate) / 100
              : 0,
            category: item.category,
            sortOrder: index,
          })),
        },
      },
      include: {
        client: true,
        lineItems: true,
      },
    });

    // Update client statistics
    await DatabaseService.getInstance().updateClientStatistics(data.clientId);

    // Audit log
    await this.auditService.log({
      studioId,
      userId,
      action: 'INVOICE_CREATED',
      entity: 'Invoice',
      entityId: invoice.id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        currency: invoice.currency,
      },
    });

    return invoice;
  }

  // Update invoice
  public async updateInvoice(
    invoiceId: string,
    studioId: string,
    data: Partial<{
      dueDate: Date;
      lineItems: Array<{
        id?: string;
        description: string;
        quantity: number;
        unitPrice: number;
        taxable?: boolean;
        category?: string;
      }>;
      discountPercentage: number;
      discountAmount