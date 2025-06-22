// packages/backend/src/services/advancedReporting.service.ts
import { DatabaseService } from './database.service';
import { EmailService } from './email.service';
import { PDFService } from './pdf.service';
import { ExcelService } from './excel.service';
import { StorageService } from './storage.service';
import { LoggerService } from './logger.service';
import Bull from 'bull';
import dayjs from 'dayjs';
import { Prisma } from '@prisma/client';

interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  type: 'financial' | 'operational' | 'marketing' | 'custom';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'on-demand';
  format: 'pdf' | 'excel' | 'csv' | 'json';
  recipients: string[];
  filters: Record<string, any>;
  metrics: string[];
  groupBy?: string[];
  sortBy?: string;
  schedule?: {
    dayOfWeek?: number;
    dayOfMonth?: number;
    hour: number;
    minute: number;
  };
}

interface ReportData {
  title: string;
  subtitle: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: Record<string, any>;
  details: any[];
  charts?: Array<{
    type: 'line' | 'bar' | 'pie' | 'area';
    data: any;
    options: any;
  }>;
  insights?: Array<{
    type: 'info' | 'warning' | 'success';
    message: string;
    value?: any;
  }>;
}

export class AdvancedReportingService {
  private static instance: AdvancedReportingService;
  private db = DatabaseService.getInstance().getClient();
  private emailService = EmailService.getInstance();
  private pdfService = PDFService.getInstance();
  private excelService = ExcelService.getInstance();
  private storageService = StorageService.getInstance();
  private logger = LoggerService.getInstance();
  private reportQueue: Bull.Queue;

  private reportDefinitions: Map<string, ReportDefinition> = new Map();

  private constructor() {
    this.reportQueue = new Bull('report-generation', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });

    this.initializeReportDefinitions();
    this.setupReportScheduler();
  }

  public static getInstance(): AdvancedReportingService {
    if (!AdvancedReportingService.instance) {
      AdvancedReportingService.instance = new AdvancedReportingService();
    }
    return AdvancedReportingService.instance;
  }

  private initializeReportDefinitions() {
    // Financial Reports
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

    // Operational Reports
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
        dayOfWeek: 1, // Monday
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

    // Marketing Reports
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

  private setupReportScheduler() {
    // Process scheduled reports
    this.reportQueue.process('scheduled-report', async (job) => {
      const { reportId, studioId } = job.data;
      await this.generateScheduledReport(reportId, studioId);
    });

    // Schedule reports based on definitions
    for (const [id, definition] of this.reportDefinitions) {
      if (definition.frequency !== 'on-demand' && definition.schedule) {
        this.scheduleReport(id, definition);
      }
    }
  }

  private scheduleReport(reportId: string, definition: ReportDefinition) {
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
        // First day of each quarter
        cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} 1 1,4,7,10 *`;
        break;
      case 'yearly':
        cronPattern = `${definition.schedule.minute} ${definition.schedule.hour} 1 1 *`;
        break;
    }

    if (cronPattern) {
      this.reportQueue.add(
        'scheduled-report',
        { reportId },
        {
          repeat: { cron: cronPattern },
        }
      );
    }
  }

  // Generate report
  public async generateReport(
    reportId: string,
    studioId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      filters?: Record<string, any>;
      format?: 'pdf' | 'excel' | 'csv' | 'json';
    }
  ): Promise<{ url: string; expiresAt: Date }> {
    const definition = this.reportDefinitions.get(reportId);
    if (!definition) {
      throw new Error('Report definition not found');
    }

    // Determine date range
    const { startDate, endDate } = this.getReportDateRange(definition.frequency, options);

    // Generate report data
    const reportData = await this.generateReportData(
      definition,
      studioId,
      startDate,
      endDate,
      options?.filters
    );

    // Generate report file
    const format = options?.format || definition.format;
    const file = await this.generateReportFile(reportData, format, studioId);

    // Upload to storage
    const uploadResult = await this.storageService.uploadFile(file, {
      folder: `reports/${studioId}/${dayjs().format('YYYY/MM')}`,
      expires: 30, // 30 days
    });

    return {
      url: uploadResult.url,
      expiresAt: uploadResult.expiresAt,
    };
  }

  // Generate scheduled report
  private async generateScheduledReport(reportId: string, studioId: string) {
    try {
      const definition = this.reportDefinitions.get(reportId);
      if (!definition) {
        throw new Error('Report definition not found');
      }

      // Get studios that have this report enabled
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
        // Get report recipients
        const recipientsSetting = await this.db.systemSetting.findFirst({
          where: {
            studioId: studio.id,
            key: `report_${reportId}_recipients`,
          },
        });

        const recipients = (recipientsSetting?.value as string[]) || [];
        
        if (recipients.length === 0) continue;

        // Generate report
        const report = await this.generateReport(reportId, studio.id);

        // Send to recipients
        await this.emailService.sendReportEmail({
          recipients,
          reportName: definition.name,
          reportUrl: report.url,
          expiresAt: report.expiresAt,
          studioName: studio.name,
        });

        this.logger.info(`Scheduled report ${reportId} sent to ${recipients.length} recipients for studio ${studio.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to generate scheduled report ${reportId}:`, error);
    }
  }

  // Generate report data
  private async generateReportData(
    definition: ReportDefinition,
    studioId: string,
    startDate: Date,
    endDate: Date,
    additionalFilters?: Record<string, any>
  ): Promise<ReportData> {
    const studio = await this.db.studio.findUnique({
      where: { id: studioId },
    });

    if (!studio) {
      throw new Error('Studio not found');
    }

    let reportData: ReportData = {
      title: definition.name,
      subtitle: `${studio.name} - ${dayjs(startDate).format('MMM D, YYYY')} to ${dayjs(endDate).format('MMM D, YYYY')}`,
      period: { start: startDate, end: endDate },
      summary: {},
      details: [],
      charts: [],
      insights: [],
    };

    // Generate data based on report type
    switch (definition.type) {
      case 'financial':
        reportData = await this.generateFinancialReportData(
          definition,
          studioId,
          startDate,
          endDate,
          additionalFilters
        );
        break;
      case 'operational':
        reportData = await this.generateOperationalReportData(
          definition,
          studioId,
          startDate,
          endDate,
          additionalFilters
        );
        break;
      case