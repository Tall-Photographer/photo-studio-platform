export declare class AdvancedReportingService {
    private static instance;
    private db;
    private emailService;
    private pdfService;
    private excelService;
    private storageService;
    private logger;
    private reportQueue;
    private reportDefinitions;
    private constructor();
    static getInstance(): AdvancedReportingService;
    private initializeReportDefinitions;
    private setupReportScheduler;
    private scheduleReport;
    generateReport(reportId: string, studioId: string, options?: {
        startDate?: Date;
        endDate?: Date;
        filters?: Record<string, any>;
        format?: 'pdf' | 'excel' | 'csv' | 'json';
    }): Promise<{
        url: string;
        expiresAt: Date;
    }>;
    private generateScheduledReport;
    private generateReportData;
}
