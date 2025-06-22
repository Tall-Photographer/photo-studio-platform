"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvancedReportingService = void 0;
const database_service_1 = require("./database.service");
const email_service_1 = require("./email.service");
const pdf_service_1 = require("./pdf.service");
const excel_service_1 = require("./excel.service");
const storage_service_1 = require("./storage.service");
const logger_service_1 = require("./logger.service");
const bull_1 = __importDefault(require("bull"));
const dayjs_1 = __importDefault(require("dayjs"));
class AdvancedReportingService {
    constructor() {
        this.db = database_service_1.DatabaseService.getInstance().getClient();
        this.emailService = email_service_1.EmailService.getInstance();
        this.pdfService = pdf_service_1.PDFService.getInstance();
        this.excelService = excel_service_1.ExcelService.getInstance();
        this.storageService = storage_service_1.StorageService.getInstance();
        this.logger = logger_service_1.LoggerService.getInstance();
        this.reportDefinitions = new Map();
        this.reportQueue = new bull_1.default('report-generation', {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379', 10),
            },
        });
        this.initializeReportDefinitions();
        this.setupReportScheduler();
    }
    static getInstance() {
        if (!AdvancedReportingService.instance) {
            AdvancedReportingService.instance = new AdvancedReportingService();
        }
        return AdvancedReportingService.instance;
    }
    initializeReportDefinitions() {
        this.reportDefinitions.set('monthly-financial-summary', {
            id: 'monthly-financial-summary',
            name: 'Monthly Financial Summary',
            description: 'Comprehensive financial overview including revenue, expenses, and profitability',
            type: 'financial',
            frequency: 'monthly',
            format: 'pdf',
            recipients: [],
            filters: {},
            metrics: ['revenue', 'expenses', 'profit', 'cash_flow', 'outstanding_invoices'],
            schedule: {
                dayOfMonth: 1,
                hour: 9,
                minute: 0,
            },
        });
        this.reportDefinitions.set('client-revenue-analysis', {
            id: 'client-revenue-analysis',
            name: 'Client Revenue Analysis',
            description: 'Detailed breakdown of revenue by client with trends and insights',
            type: 'financial',
            frequency: 'monthly',
            format: 'excel',
            recipients: [],
            filters: {},
            metrics: ['revenue_per_client', 'client_ltv', 'payment_trends'],
            groupBy: ['client'],
            sortBy: 'revenue_desc',
        });
        this.reportDefinitions.set('team-performance', {
            id: 'team-performance',
            name: 'Team Performance Report',
            description: 'Team utilization, productivity, and performance metrics',
            type: 'operational',
            frequency: 'weekly',
            format: 'pdf',
            recipients: [],
            filters: {},
            metrics: ['bookings_per_photographer', 'revenue_per_photographer', 'utilization_rate', 'client_satisfaction'],
            groupBy: ['photographer'],
            schedule: {
                dayOfWeek: 1,
                hour: 8,
                minute: 0,
            },
        });
        this.reportDefinitions.set('equipment-utilization', {
            id: 'equipment-utilization',
            name: 'Equipment Utilization Report',
            description: 'Equipment usage patterns, maintenance needs, and ROI analysis',
            type: 'operational',
            frequency: 'monthly',
            format: 'excel',
            recipients: [],
            filters: {},
            metrics: ['equipment_usage', 'maintenance_costs', 'equipment_roi', 'depreciation'],
            groupBy: ['equipment_category'],
        });
        this.reportDefinitions.set('marketing-effectiveness', {
            id: 'marketing-effectiveness',
            name: 'Marketing Effectiveness Report',
            description: 'Campaign performance, lead generation, and conversion metrics',
            type: 'marketing',
            frequency: 'monthly',
            format: 'pdf',
            recipients: [],
            filters: {},
            metrics: ['campaign_roi', 'lead_conversion', 'client_acquisition_cost', 'channel_performance'],
            groupBy: ['marketing_channel'],
        });
        this.reportDefinitions.set('client-retention', {
            id: 'client-retention',
            name: 'Client Retention Analysis',
            description: 'Client retention rates, churn analysis, and loyalty metrics',
            type: 'marketing',
            frequency: 'quarterly',
            format: 'pdf',
            recipients: [],
            filters: {},
            metrics: ['retention_rate', 'churn_rate', 'repeat_booking_rate', 'client_lifetime_value'],
        });
    }
    setupReportScheduler() {
        this.reportQueue.process('scheduled-report', async (job) => {
            const { reportId, studioId } = job.data;
            await this.generateScheduledReport(reportId, studioId);
        });
        for (const [id, definition] of this.reportDefinitions) {
            if (definition.frequency !== 'on-demand' && definition.schedule) {
                this.scheduleReport(id, definition);
            }
        }
    }
    scheduleReport(reportId, definition) {
        let cronPattern = '';
        switch (definition.frequency) {
            case 'daily':
                cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} * * *`;
                break;
            case 'weekly':
                cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} * * ${definition.schedule.dayOfWeek}`;
                break;
            case 'monthly':
                cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} ${definition.schedule.dayOfMonth} * *`;
                break;
            case 'quarterly':
                cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} 1 1,4,7,10 *`;
                break;
            case 'yearly':
                cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} 1 1 *`;
                break;
        }
        if (cronPattern) {
            this.reportQueue.add('scheduled-report', { reportId }, {
                repeat: { cron: cronPattern },
            });
        }
    }
    async generateReport(reportId, studioId, options) {
        const definition = this.reportDefinitions.get(reportId);
        if (!definition) {
            throw new Error('Report definition not found');
        }
        const { startDate, endDate } = this.getReportDateRange(definition.frequency, options);
        const reportData = await this.generateReportData(definition, studioId, startDate, endDate, options?.filters);
        const format = options?.format || definition.format;
        const file = await this.generateReportFile(reportData, format, studioId);
        const uploadResult = await this.storageService.uploadFile(file, {
            folder: `reports/${studioId}/${(0, dayjs_1.default)().format('YYYY/MM')}`,
            expires: 30,
        });
        return {
            url: uploadResult.url,
            expiresAt: uploadResult.expiresAt,
        };
    }
    async generateScheduledReport(reportId, studioId) {
        try {
            const definition = this.reportDefinitions.get(reportId);
            if (!definition) {
                throw new Error('Report definition not found');
            }
            const studios = await this.db.studio.findMany({
                where: {
                    deletedAt: null,
                    systemSettings: {
                        some: {
                            key: `report_${reportId}_enabled`,
                            value: true,
                        },
                    },
                },
            });
            for (const studio of studios) {
                const recipientsSetting = await this.db.systemSetting.findFirst({
                    where: {
                        studioId: studio.id,
                        key: `report_${reportId}_recipients`,
                    },
                });
                const recipients = recipientsSetting?.value || [];
                if (recipients.length === 0)
                    continue;
                const report = await this.generateReport(reportId, studio.id);
                await this.emailService.sendReportEmail({
                    recipients,
                    reportName: definition.name,
                    reportUrl: report.url,
                    expiresAt: report.expiresAt,
                    studioName: studio.name,
                });
                this.logger.info(`Scheduled report ${reportId} sent to ${recipients.length} recipients for studio ${studio.id}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to generate scheduled report ${reportId}:`, error);
        }
    }
    async generateReportData(definition, studioId, startDate, endDate, additionalFilters) {
        const studio = await this.db.studio.findUnique({
            where: { id: studioId },
        });
        if (!studio) {
            throw new Error('Studio not found');
        }
        let reportData = {
            title: definition.name,
            subtitle: `${studio.name} - ${(0, dayjs_1.default)(startDate).format('MMM D, YYYY')} to ${(0, dayjs_1.default)(endDate).format('MMM D, YYYY')}`,
            period: { start: startDate, end: endDate },
            summary: {},
            details: [],
            charts: [],
            insights: [],
        };
        switch (definition.type) {
            case 'financial':
                reportData = await this.generateFinancialReportData(definition, studioId, startDate, endDate, additionalFilters);
                break;
            case 'operational':
                reportData = await this.generateOperationalReportData(definition, studioId, startDate, endDate, additionalFilters);
                break;
            case :
        }
    }
}
exports.AdvancedReportingService = AdvancedReportingService;
