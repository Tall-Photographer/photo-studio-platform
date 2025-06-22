// packages/backend/src/middleware/security.ts
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../services/logger.service';

const logger = LoggerService.getInstance();

export const securityMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Remove sensitive headers
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Log suspicious requests
  const suspiciousPatterns = [
    /\.\./,
    /script/i,
    /union.*select/i,
    /drop.*table/i,
  ];
  
  const url = req.url.toLowerCase();
  const body = JSON.stringify(req.body).toLowerCase();
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url) || pattern.test(body)) {
      logger.warn('Suspicious request detected', {
        ip: req.ip,
        url: req.url,
        userAgent: req.get('User-Agent'),
      });
      break;
    }
  }
  
  next();
};