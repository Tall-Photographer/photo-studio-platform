export declare class CronService {
    private static instance;
    private logger;
    private isRunning;
    private constructor();
    static getInstance(): CronService;
    start(): void;
    stop(): void;
}
