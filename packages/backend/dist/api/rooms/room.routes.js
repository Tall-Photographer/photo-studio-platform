"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', auth_1.requireStaff, (req, res) => {
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
            'POST /api/v1/projects/:id/files - Upload files'
        ]
    });
});
exports.default = router;
