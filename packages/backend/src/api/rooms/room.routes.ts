// File: packages/backend/src/api/projects/project.routes.ts
// Project management routes

import { Router, Request, Response } from 'express';
import { requireStaff } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/projects:
 *   get:
 *     summary: Get all projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requireStaff, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Project routes - implementation in progress',
    endpoints: [
      'GET /api/v1/projects - List projects',
      'GET /api/v1/projects/:id - Get project',
      'POST /api/v1/projects - Create project',
      'PUT /api/v1/projects/:id - Update project',
      'DELETE /api/v1/projects/:id - Delete project',
      'GET /api/v1/projects/:id/files - Get project files',
      'POST /api/v1/projects/:id/files - Upload files',
    ],
  });
});

export default router;
