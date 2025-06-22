// File: packages/backend/src/api/invoices/invoice.routes.ts
// Invoice management routes

import { Router, Request, Response } from 'express';
import { requireStaff } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/invoices:
 *   get:
 *     summary: Get all invoices
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireStaff, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Invoice routes - implementation in progress',
    endpoints: [
      'GET /api/v1/invoices - List invoices',
      'GET /api/v1/invoices/:id - Get invoice',
      'POST /api/v1/invoices - Create invoice',
      'PUT /api/v1/invoices/:id - Update invoice',
      'DELETE /api/v1/invoices/:id - Delete invoice',
      'POST /api/v1/invoices/:id/send - Send invoice',
      'GET /api/v1/invoices/:id/pdf - Download PDF',
    ],
  });
});

export default router;
