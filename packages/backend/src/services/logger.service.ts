// packages/backend/src/services/logger.service.ts
import winston from 'winston';
import path from 'path';

export class LoggerService {
  private static instance: LoggerService;
  private logger: winston.Logger;

  private constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.prettyPrint()
      ),
      defaultMeta: {
        service: 'shootlinks-backend',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              let metaStr = '';
              if (Object.keys(meta).length > 0) {
                metaStr = '\n' + JSON.stringify(meta, null, 2);
              }
              return `${timestamp} [${level}]: ${message}${metaStr}`;
            })
          ),
        }),
      ],
    });

    // Add file transport for production
    if (process.env.NODE_ENV === 'production') {
      this.addFileTransports();
    }
  }

  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  private addFileTransports(): void {
    const logDir = process.env.LOG_DIR || 'logs';

    // Error log file
    this.logger.add(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      })
    );

    // Combined log file
    this.logger.add(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      })
    );
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public error(message: string, error?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
    } else {
      this.logger.error(message, { error });
    }
  }

  public getLogger(): winston.Logger {
    return this.logger;
  }
}
