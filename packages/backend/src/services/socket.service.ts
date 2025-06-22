// packages/backend/src/services/socket.service.ts
import { Server as SocketServer } from 'socket.io';
import { LoggerService } from './logger.service';

export class SocketService {
  private static instance: SocketService;
  private io?: SocketServer;
  private logger = LoggerService.getInstance();

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public static initialize(io: SocketServer, redis?: any): void {
    const instance = SocketService.getInstance();
    instance.io = io;
    instance.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      this.logger.debug(`Socket connected: ${socket.id}`);

      socket.on('join:studio', (studioId: string) => {
        socket.join(`studio:${studioId}`);
      });

      socket.on('disconnect', () => {
        this.logger.debug(`Socket disconnected: ${socket.id}`);
      });
    });
  }

  public emit(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public emitToStudio(studioId: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(`studio:${studioId}`).emit(event, data);
    }
  }
}