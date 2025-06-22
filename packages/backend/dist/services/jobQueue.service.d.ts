export declare class JobQueueService {
    private static instance;
    private logger;
    private isInitialized;
    private constructor();
    static getInstance(): JobQueueService;
    initialize(): Promise<void>;
    addJob(type: string, data: any): Promise<void>;
    stop(): Promise<void>;
}
