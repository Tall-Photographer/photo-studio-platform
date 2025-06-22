// File: packages/backend/src/api/clients/client.routes.ts
// Client management routes

import { Router, Request, Response } from 'express';
import { requireStaff } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/clients:
 *   get:
 *     summary: Get all clients
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireStaff, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Client routes - implementation in progress',
    endpoints: [
      'GET /api/v1/clients - List clients',
      'GET /api/v1/clients/:id - Get client',
      'POST /api/v1/clients - Create client',
      'PUT /api/v1/clients/:id - Update client',
      'DELETE /api/v1/clients/:id - Delete client',
      'GET /api/v1/clients/:id/bookings - Get client bookings',
    ],
  });
});

export default router;
