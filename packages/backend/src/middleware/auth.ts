// packages/backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { DatabaseService } from '../services/database.service';
import { CacheService } from '../services/cache.service';
import { LoggerService } from '../services/logger.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    studioId: string;
    email: string;
    role: UserRole;
    sessionId: string;
  };
  studio?: {
    id: string;
    slug: string;
  };
}

export class AuthMiddleware {
  private static db = DatabaseService.getInstance().getClient();
  private static cache = CacheService.getInstance();
  private static logger = LoggerService.getInstance();

  // Verify JWT Token
  public static async authenticate(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Get token from header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        studioId: string;
        email: string;
        role: UserRole;
        sessionId: string;
      };

      // Check session in cache first
      const cachedSession = await AuthMiddleware.cache.get(`session:${decoded.sessionId}`);
      
      if (!cachedSession) {
        // Check session in database
        const session = await AuthMiddleware.db.userSession.findUnique({
          where: { id: decoded.sessionId },
          include: {
            user: {
              include: { studio: true },
            },
          },
        });

        if (!session || session.expiresAt < new Date()) {
          return res.status(401).json({ error: 'Session expired' });
        }

        // Update cache
        await AuthMiddleware.cache.set(
          `session:${session.id}`,
          {
            userId: session.user.id,
            studioId: session.user.studioId,
            role: session.user.role,
          },
          300 // 5 minutes
        );

        // Update last activity
        await AuthMiddleware.db.userSession.update({
          where: { id: session.id },
          data: { lastActivityAt: new Date() },
        });

        // Set request context
        req.user = {
          id: session.user.id,
          studioId: session.user.studioId,
          email: session.user.email,
          role: session.user.role,
          sessionId: session.id,
        };

        req.studio = {
          id: session.user.studio.id,
          slug: session.user.studio.slug,
        };
      } else {
        req.user = decoded;
        
        // Get studio info
        const studio = await AuthMiddleware.db.studio.findUnique({
          where: { id: decoded.studioId },
          select: { id: true, slug: true },
        });

        if (studio) {
          req.studio = studio;
        }
      }

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: 'Token expired' });
      }
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      AuthMiddleware.logger.error('Authentication error:', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  }

  // Check specific role
  public static requireRole(...roles: UserRole[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          required: roles,
          current: req.user.role,
        });
      }

      next();
    };
  }

  // Check if user is admin (Studio Admin or Super Admin)
  public static requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.user.role !== 'STUDIO_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  }

  // Check if user can manage resources (Admin or Manager with permissions)
  public static async requireManager(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Admins always have access
    if (req.user.role === 'STUDIO_ADMIN' || req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    // Check if user is a manager
    if (req.user.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Manager access required' });
    }

    // For managers, check specific permissions based on the resource
    const resource = req.baseUrl.split('/').pop();
    const permission = await AuthMiddleware.checkManagerPermission(req.user.id, resource!);

    if (!permission) {
      return res.status(403).json({ 
        error: 'Insufficient manager permissions',
        resource,
      });
    }

    next();
  }

  // Check resource ownership
  public static async requireOwnership(resourceType: string) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Admins can access everything
      if (req.user.role === 'STUDIO_ADMIN' || req.user.role === 'SUPER_ADMIN') {
        return next();
      }

      const resourceId = req.params.id;
      if (!resourceId) {
        return res.status(400).json({ error: 'Resource ID required' });
      }

      const hasAccess = await AuthMiddleware.checkResourceAccess(
        req.user,
        resourceType,
        resourceId
      );

      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Access denied',
          resource: resourceType,
          id: resourceId,
        });
      }

      next();
    };
  }

  // Check studio membership
  public static async requireStudioMember(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const studioId = req.params.studioId || req.body.studioId || req.query.studioId;
    
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID required' });
    }

    if (req.user.studioId !== studioId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Not a member of this studio' });
    }

    next();
  }

  // Optional authentication - doesn't fail if no token
  public static async optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    // Use the authenticate method but catch errors
    try {
      await AuthMiddleware.authenticate(req, res, () => {
        next();
      });
    } catch (error) {
      // Continue without authentication
      next();
    }
  }

  // Helper methods
  private static async checkManagerPermission(
    userId: string,
    resource: string
  ): Promise<boolean> {
    // Get manager permissions from system settings
    const user = await AuthMiddleware.db.user.findUnique({
      where: { id: userId },
      include: {
        studio: {
          include: {
            systemSettings: {
              where: {
                key: 'manager_permissions',
                category: 'permissions',
              },
            },
          },
        },
      },
    });

    if (!user) return false;

    const permissionSetting = user.studio.systemSettings[0];
    if (!permissionSetting) return false;

    const permissions = permissionSetting.value as any;
    const resourcePermissions = permissions[resource] || [];

    return resourcePermissions.length > 0;
  }

  private static async checkResourceAccess(
    user: { id: string; studioId: string; role: UserRole },
    resourceType: string,
    resourceId: string
  ): Promise<boolean> {
    switch (resourceType) {
      case 'booking':
        const booking = await AuthMiddleware.db.booking.findFirst({
          where: {
            id: resourceId,
            studioId: user.studioId,
            OR: [
              { createdById: user.id },
              { assignments: { some: { userId: user.id } } },
              { client: { email: user.email } },
            ],
          },
        });
        return !!booking;

      case 'project':
        const project = await AuthMiddleware.db.project.findFirst({
          where: {
            id: resourceId,
            studioId: user.studioId,
            OR: [
              { createdById: user.id },
              { editorId: user.id },
              { assignments: { some: { userId: user.id } } },
              { client: { email: user.email } },
            ],
          },
        });
        return !!project;

      case 'invoice':
        if (user.role === 'CLIENT') {
          const invoice = await AuthMiddleware.db.invoice.findFirst({
            where: {
              id: resourceId,
              studioId: user.studioId,
              client: { email: user.email },
            },
          });
          return !!invoice;
        }
        return true; // Staff can see all invoices

      case 'file':
        const file = await AuthMiddleware.db.file.findFirst({
          where: {
            id: resourceId,
            OR: [
              { uploadedBy: user.id },
              { project: { assignments: { some: { userId: user.id } } } },
              { client: { email: user.email } },
            ],
          },
        });
        return !!file;

      default:
        return false;
    }
  }
}

// Export middleware functions
export const authenticate = AuthMiddleware.authenticate;
export const requireRole = AuthMiddleware.requireRole;
export const requireAdmin = AuthMiddleware.requireAdmin;
export const requireManager = AuthMiddleware.requireManager;
export const requireOwnership = AuthMiddleware.requireOwnership;
export const requireStudioMember = AuthMiddleware.requireStudioMember;
export const optionalAuth = AuthMiddleware.optionalAuth;