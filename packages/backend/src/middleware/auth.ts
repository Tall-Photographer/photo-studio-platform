// packages/backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../services/database.service';
import { LoggerService } from '../services/logger.service';

interface AuthRequest extends Request {
  user?: any;
  studio?: any;
}

interface JwtPayload {
  userId: string;
  studioId: string;
  role: string;
  iat: number;
  exp: number;
}

const database = DatabaseService.getInstance();
const logger = LoggerService.getInstance();

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Access token is required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;
    
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not defined');
      res.status(500).json({
        success: false,
        message: 'Server configuration error',
      });
      return;
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    } catch (jwtError) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
      return;
    }

    const user = await database.findUserById(decoded.userId);
    if (!user || user.deletedAt) {
      res.status(401).json({
        success: false,
        message: 'User not found or deactivated',
      });
      return;
    }

    req.user = user;
    req.studio = user.studio;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
      return;
    }
    next();
  };
};

export const requireAdmin = requireRole(['SUPER_ADMIN', 'STUDIO_ADMIN']);
export const requireManagerOrAdmin = requireRole(['SUPER_ADMIN', 'STUDIO_ADMIN', 'MANAGER']);
export const requireStaff = requireRole([
  'SUPER_ADMIN',
  'STUDIO_ADMIN', 
  'MANAGER',
  'PHOTOGRAPHER',
  'VIDEOGRAPHER',
  'ASSISTANT',
  'EDITOR'
]);