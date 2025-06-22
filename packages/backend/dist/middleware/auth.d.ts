import { Request, Response, NextFunction } from 'express';
interface AuthRequest extends Request {
    user?: any;
    studio?: any;
}
export declare const authMiddleware: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export declare const requireRole: (allowedRoles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const requireAdmin: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const requireManagerOrAdmin: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const requireStaff: (req: AuthRequest, res: Response, next: NextFunction) => void;
export {};
