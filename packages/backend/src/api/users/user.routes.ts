// File: packages/backend/src/api/users/user.routes.ts
// User management routes

import { Router, Request, Response } from 'express';
import { requireAdmin, requireManagerOrAdmin } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users in studio
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireManagerOrAdmin, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'User routes - implementation in progress',
    endpoints: [
      'GET /api/v1/users - List users',
      'GET /api/v1/users/:id - Get user',
      'POST /api/v1/users - Create user',
      'PUT /api/v1/users/:id - Update user',
      'DELETE /api/v1/users/:id - Delete user',
    ],
  });
});

export default router;
