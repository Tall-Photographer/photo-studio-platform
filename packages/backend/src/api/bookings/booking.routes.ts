// File: packages/backend/src/api/bookings/booking.routes.ts
// Booking management routes

import { Router, Request, Response } from 'express';
import { requireStaff } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/bookings:
 *   get:
 *     summary: Get all bookings
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireStaff, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Booking routes - implementation in progress',
    endpoints: [
      'GET /api/v1/bookings - List bookings',
      'GET /api/v1/bookings/:id - Get booking',
      'POST /api/v1/bookings - Create booking',
      'PUT /api/v1/bookings/:id - Update booking',
      'DELETE /api/v1/bookings/:id - Cancel booking',
      'GET /api/v1/bookings/calendar - Calendar view',
    ],
  });
});

export default router;
