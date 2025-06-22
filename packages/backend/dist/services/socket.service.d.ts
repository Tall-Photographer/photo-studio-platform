import { Server as SocketServer } from 'socket.io';
export declare class SocketService {
    private static instance;
    private io?;
    private logger;
    private constructor();
    static getInstance(): SocketService;
    static initialize(io: SocketServer, redis?: any): void;
    private setupEventHandlers;
    emit(event: string, data: any): void;
    emitToStudio(studioId: string, event: string, data: any): void;
}
