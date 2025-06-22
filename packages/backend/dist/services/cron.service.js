"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronService = void 0;
const logger_service_1 = require("./logger.service");
class CronService {
    constructor() {
        this.logger = logger_service_1.LoggerService.getInstance();
        this.isRunning = false;
    }
    static getInstance() {
        if (!CronService.instance) {
            CronService.instance = new CronService();
        }
        return CronService.instance;
    }
    start() {
        if (this.isRunning)
            return;
        this.logger.info('Cron service started');
        this.isRunning = true;
    }
    stop() {
        if (!this.isRunning)
            return;
        this.logger.info('Cron service stopped');
        this.isRunning = false;
    }
}
exports.CronService = CronService;
