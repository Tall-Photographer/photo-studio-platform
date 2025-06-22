"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialService = void 0;
const client_1 = require("@prisma/client");
const stripe_1 = __importDefault(require("stripe"));
const paypal = __importStar(require("paypal-rest-sdk"));
const database_service_1 = require("./database.service");
const email_service_1 = require("./email.service");
const logger_service_1 = require("./logger.service");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const pdf_service_1 = require("./pdf.service");
const accounting_service_1 = require("./accounting.service");
const dayjs_1 = __importDefault(require("dayjs"));
class FinancialService {
    constructor() {
        this.db = database_service_1.DatabaseService.getInstance().getClient();
        this.emailService = email_service_1.EmailService.getInstance();
        this.logger = logger_service_1.LoggerService.getInstance();
        this.auditService = audit_service_1.AuditService.getInstance();
        this.notificationService = notification_service_1.NotificationService.getInstance();
        this.pdfService = pdf_service_1.PDFService.getInstance();
        this.accountingService = accounting_service_1.AccountingService.getInstance();
        this.stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
            apiVersion: '2023-10-16',
        });
        paypal.configure({
            mode: process.env.PAYPAL_MODE || 'sandbox',
            client_id: process.env.PAYPAL_CLIENT_ID,
            client_secret: process.env.PAYPAL_CLIENT_SECRET,
        });
    }
    static getInstance() {
        if (!FinancialService.instance) {
            FinancialService.instance = new FinancialService();
        }
        return FinancialService.instance;
    }
    async getInvoices(studioId, filters, page = 1, limit = 20) {
        const where = {
            studioId,
        };
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
    async getInvoiceById(invoiceId, studioId) {
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
}
exports.FinancialService = FinancialService;
 > ,
    userId;
string;
{
    const invoice = await this.getInvoiceById(invoiceId, studioId);
    if (invoice.status === 'PAID') {
        throw new Error('Cannot update paid invoice');
    }
    const oldValues = { ...invoice };
    if (data.lineItems) {
        await this.db.invoiceLineItem.deleteMany({
            where: { invoiceId },
        });
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
    await database_service_1.DatabaseService.getInstance().recalculateInvoiceTotals(invoiceId);
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
    if (oldValues.status !== 'SENT' && updated.status === 'SENT') {
        await this.sendInvoiceEmail(updated.id);
    }
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
async;
sendInvoiceEmail(invoiceId, string);
{
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
    const pdf = await this.pdfService.generateInvoicePDF(invoice);
    await this.emailService.sendInvoiceEmail(invoice.client.email, invoice.client.firstName, invoice.invoiceNumber, invoice.total, invoice.currency, invoice.dueDate, pdf);
    await this.db.invoice.update({
        where: { id: invoiceId },
        data: {
            status: 'SENT',
            sentAt: new Date(),
        },
    });
    const reminderDate = (0, dayjs_1.default)(invoice.dueDate).subtract(3, 'days').toDate();
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
async;
createPaymentIntent(data, {
    amount: number,
    currency: client_1.Currency,
    clientId: string,
    invoiceId: string,
    bookingId: string,
    gateway: client_1.PaymentGateway,
    metadata: (Record)
}, studioId, string);
Promise < PaymentIntent > {
    const: gatewaySettings = await this.db.systemSetting.findFirst({
        where: {
            studioId,
            key: `${data.gateway.toLowerCase()}_settings`,
            category: 'payment',
        },
    }),
    if(, gatewaySettings) {
        throw new Error(`${data.gateway} not configured for this studio`);
    },
    switch(data) { }, : .gateway
};
{
    'STRIPE';
    return this.createStripePaymentIntent(data, gatewaySettings.value);
    'PAYPAL';
    return this.createPayPalPayment(data, gatewaySettings.value);
    throw new Error(`Unsupported payment gateway: ${data.gateway}`);
}
async;
createStripePaymentIntent(data, any, settings, any);
Promise < PaymentIntent > {
    const: client = await this.db.client.findUnique({
        where: { id: data.clientId },
    }),
    if(, client) {
        throw new Error('Client not found');
    },
    let, stripeCustomerId = client.metadata?.stripeCustomerId,
    if(, stripeCustomerId) {
        const customer = await this.stripe.customers.create({
            email: client.email,
            name: `${client.firstName} ${client.lastName}`,
            metadata: {
                clientId: client.id,
                studioId: client.studioId,
            },
        });
        stripeCustomerId = customer.id;
        await this.db.client.update({
            where: { id: client.id },
            data: {
                metadata: {
                    ...(client.metadata || {}),
                    stripeCustomerId,
                },
            },
        });
    },
    const: paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(data.amount * 100),
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
    }),
    return: {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: data.amount,
        currency: data.currency,
        status: paymentIntent.status,
    }
};
async;
createPayPalPayment(data, any, settings, any);
Promise < PaymentIntent > {
    const: createPaymentJson = {
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
    },
    return: new Promise((resolve, reject) => {
        paypal.payment.create(createPaymentJson, (error, payment) => {
            if (error) {
                reject(error);
            }
            else {
                const approvalUrl = payment.links?.find(link => link.rel === 'approval_url')?.href;
                resolve({
                    id: payment.id,
                    clientSecret: approvalUrl || '',
                    amount: data.amount,
                    currency: data.currency,
                    status: payment.state || 'created',
                });
            }
        });
    })
};
async;
processPayment(paymentIntentId, string, gateway, client_1.PaymentGateway, studioId, string, userId, string);
{
    let paymentData;
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
    if (payment.invoiceId && payment.status === 'COMPLETED') {
        await this.applyPaymentToInvoice(payment.id, payment.invoiceId);
    }
    await database_service_1.DatabaseService.getInstance().updateClientStatistics(payment.clientId);
    if (payment.status === 'COMPLETED') {
        const client = await this.db.client.findUnique({
            where: { id: payment.clientId },
        });
        if (client) {
            await this.emailService.sendPaymentConfirmation(client.email, client.firstName, payment.paymentNumber, payment.amount, payment.currency);
        }
    }
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
async;
applyPaymentToInvoice(paymentId, string, invoiceId, string);
{
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
    const totalPaid = invoice.payments.reduce((sum, p) => {
        return sum + Number(p.amount);
    }, 0);
    const amountDue = Number(invoice.total) - totalPaid;
    await this.db.invoice.update({
        where: { id: invoiceId },
        data: {
            amountPaid: totalPaid,
            amountDue,
            status: amountDue <= 0 ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: amountDue <= 0 ? new Date() : null,
        },
    });
    if (invoice.bookingId) {
        await this.db.booking.update({
            where: { id: invoice.bookingId },
            data: {
                status: 'CONFIRMED',
                confirmedAt: new Date(),
            },
        });
    }
    await this.accountingService.syncPayment(payment);
}
async;
getPayments(studioId, string, filters, PaymentFilters, page, number = 1, limit, number = 20);
{
    const where = {
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
async;
processRefund(paymentId, string, amount, number, reason, string, studioId, string, userId, string);
{
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
    let refundResult;
    switch (payment.gateway) {
        case 'STRIPE':
            const refund = await this.stripe.refunds.create({
                payment_intent: payment.gatewayTransactionId,
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
    const client = await this.db.client.findUnique({
        where: { id: payment.clientId },
    });
    if (client) {
        await this.emailService.sendRefundConfirmation(client.email, client.firstName, payment.paymentNumber, amount, payment.currency, reason);
    }
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
async;
getFinancialSummary(studioId, string, startDate, Date, endDate, Date);
Promise < FinancialSummary > {
    const: [
        revenueData,
        outstandingData,
        overdueData,
        paymentTimeData,
        monthlyRevenue,
        serviceRevenue,
        topClients,
        paymentMethods,
    ] = await Promise.all([
        this.db.payment.aggregate({
            where: {
                studioId,
                status: 'COMPLETED',
                processedAt: { gte: startDate, lte: endDate },
            },
            _sum: { amount: true },
        }),
        this.db.invoice.aggregate({
            where: {
                studioId,
                status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
            },
            _sum: { amountDue: true },
        }),
        this.db.invoice.aggregate({
            where: {
                studioId,
                status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
                dueDate: { lt: new Date() },
            },
            _sum: { amountDue: true },
        }),
        this.db.$queryRaw `
        SELECT AVG(EXTRACT(DAY FROM (i."paidAt" - i."issueDate"))) as avg_days
        FROM "Invoice" i
        WHERE i."studioId" = ${studioId}
          AND i.status = 'PAID'
          AND i."paidAt" IS NOT NULL
          AND i."issueDate" >= ${startDate}
          AND i."issueDate" <= ${endDate}
      `,
        this.db.$queryRaw `
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
        this.db.$queryRaw `
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
        this.db.$queryRaw `
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
    ]),
    const: revenueByService
};
{ }
;
serviceRevenue.forEach((item) => {
    revenueByService[item.category] = Number(item.amount);
});
const paymentMethodBreakdown = {};
paymentMethods.forEach((item) => {
    paymentMethodBreakdown[item.gateway] = Number(item._sum.amount || 0);
});
return {
    totalRevenue: Number(revenueData._sum.amount || 0),
    totalOutstanding: Number(outstandingData._sum.amountDue || 0),
    totalOverdue: Number(overdueData._sum.amountDue || 0),
    averagePaymentTime: Number(paymentTimeData[0]?.avg_days || 0),
    revenueByMonth: monthlyRevenue.map((item) => ({
        month: (0, dayjs_1.default)(item.month).format('YYYY-MM'),
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
async;
generateFinancialReport(studioId, string, type, 'income' | 'expenses' | 'profit_loss' | 'tax', startDate, Date, endDate, Date, format, 'pdf' | 'excel', 'pdf');
{
    const studio = await this.db.studio.findUnique({
        where: { id: studioId },
    });
    if (!studio) {
        throw new Error('Studio not found');
    }
    let reportData;
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
    }
    else {
        throw new Error('Excel export not implemented yet');
    }
}
async;
generateIncomeReport(studioId, string, startDate, Date, endDate, Date);
{
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
async;
generateExpenseReport(studioId, string, startDate, Date, endDate, Date);
{
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
async;
generateProfitLossReport(studioId, string, startDate, Date, endDate, Date);
{
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
async;
generateTaxReport(studioId, string, startDate, Date, endDate, Date);
{
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
    };
}
async;
processRecurringInvoices(studioId, string);
{
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
            const invoice = await this.createInvoice({
                clientId: booking.clientId,
                bookingId: booking.id,
                dueDate: (0, dayjs_1.default)().add(30, 'days').toDate(),
                lineItems: [{
                        description: booking.title,
                        quantity: 1,
                        unitPrice: Number(booking.totalAmount),
                        category: booking.type,
                    }],
                currency: booking.currency,
                paymentTerms: 'Net 30',
            }, studioId, 'system');
            invoicesCreated.push(invoice);
        }
        catch (error) {
            this.logger.error('Failed to create recurring invoice:', error);
        }
    }
    return invoicesCreated;
}
async;
sendPaymentReminders(studioId, string);
{
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
        const daysPastDue = (0, dayjs_1.default)().diff(invoice.dueDate, 'days');
        if ([3, 7, 14, 30].includes(daysPastDue)) {
            await this.emailService.sendPaymentReminder(invoice.client.email, invoice.client.firstName, invoice.invoiceNumber, invoice.amountDue, invoice.currency, daysPastDue);
            if (invoice.status !== 'OVERDUE') {
                await this.db.invoice.update({
                    where: { id: invoice.id },
                    data: { status: 'OVERDUE' },
                });
            }
        }
    }
}
number;
taxRate ?  : number;
currency: client_1.Currency;
paymentTerms ?  : string;
notes ?  : string;
studioId: string,
    userId;
string;
{
    const studio = await this.db.studio.findUnique({
        where: { id: studioId },
    });
    if (!studio) {
        throw new Error('Studio not found');
    }
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
    await database_service_1.DatabaseService.getInstance().updateClientStatistics(data.clientId);
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
async;
updateInvoice(invoiceId, string, studioId, string, data, Partial < {
    dueDate: Date,
    lineItems: (Array),
    discountPercentage: number,
    discountAmount
});
