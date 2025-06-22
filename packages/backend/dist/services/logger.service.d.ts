import winston from "winston";
export declare class LoggerService {
  private static instance;
  private logger;
  private constructor();
  static getInstance(): LoggerService;
  private addFileTransports;
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: any): void;
  getLogger(): winston.Logger;
}
