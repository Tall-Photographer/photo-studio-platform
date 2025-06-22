// packages/backend/src/middleware/requestLogger.ts
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../services/logger.service';

const logger = LoggerService.getInstance();

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log request
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.method !== 'GET' ? req.body : undefined,
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} ${res.statusCode}`, {
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });

  next();
};