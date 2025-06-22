// packages/backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Access token is required',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not defined in environment variables');
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

    // Get user from database
    const user = await database.findUserById(decoded.userId);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // Check if user is active
    if (user.deletedAt) {
      res.status(401).json({
        success: false,
        message: 'User account is deactivated',
      });
      return;
    }

    // Check if studio is active (for non-super admins)
    if (user.role !== 'SUPER_ADMIN' && (!user.studio || user.studio.deletedAt)) {
      res.status(401).json({
        success: false,
        message: 'Studio is not active',
      });
      return;
    }

    // Attach user and studio to request
    req.user = user;
    req.studio = user.studio;

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
};

// Studio ownership verification
export const requireStudioAccess = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !req.studio) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
    return;
  }

  // Super admins can access any studio
  if (req.user.role === 'SUPER_ADMIN') {
    next();
    return;
  }

  // Check if the requested studio matches user's studio
  const requestedStudioId = req.params.studioId || req.body.studioId || req.query.studioId;
  if (requestedStudioId && requestedStudioId !== req.studio.id) {
    res.status(403).json({
      success: false,
      message: 'Access denied to this studio',
    });
    return;
  }

  next();
};

// Admin-only access
export const requireAdmin = requireRole(['SUPER_ADMIN', 'STUDIO_ADMIN']);

// Manager or admin access
export const requireManagerOrAdmin = requireRole(['SUPER_ADMIN', 'STUDIO_ADMIN', 'MANAGER']);

// Staff access (photographers, videographers, assistants, editors)
export const requireStaff = requireRole([
  'SUPER_ADMIN',
  'STUDIO_ADMIN',
  'MANAGER',
  'PHOTOGRAPHER',
  'VIDEOGRAPHER',
  'ASSISTANT',
  'EDITOR',
]);

// Optional authentication (for endpoints that work for both authenticated and non-authenticated users)
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;
    
    if (!jwtSecret) {
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      const user = await database.findUserById(decoded.userId);
      
      if (user && !user.deletedAt) {
        req.user = user;
        req.studio = user.studio;
      }
    } catch (jwtError) {
      // Invalid token, but continue without user
      logger.debug('Invalid token in optional auth:', jwtError);
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next(); // Continue without user
  }
};