// File: packages/backend/src/api/equipment/equipment.routes.ts
// Equipment management routes

import { Router, Request, Response } from 'express';
import { requireStaff } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/equipment:
 *   get:
 *     summary: Get all equipment
 *     tags: [Equipment]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireStaff, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Equipment routes - implementation in progress',
    endpoints: [
      'GET /api/v1/equipment - List equipment',
      'GET /api/v1/equipment/:id - Get equipment',
      'POST /api/v1/equipment - Create equipment',
      'PUT /api/v1/equipment/:id - Update equipment',
      'DELETE /api/v1/equipment/:id - Delete equipment',
      'POST /api/v1/equipment/:id/checkout - Checkout equipment',
      'POST /api/v1/equipment/:id/checkin - Checkin equipment',
    ],
  });
});

export default router;
