// packages/backend/src/services/cron.service.ts
import { LoggerService } from './logger.service';

export class CronService {
  private static instance: CronService;
  private logger = LoggerService.getInstance();
  private isRunning = false;

  private constructor() {}

  public static getInstance(): CronService {
    if (!CronService.instance) {
      CronService.instance = new CronService();
    }
    return CronService.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    
    this.logger.info('Cron service started');
    this.isRunning = true;
  }

  public stop(): void {
    if (!this.isRunning) return;
    
    this.logger.info('Cron service stopped');
    this.isRunning = false;
  }
}