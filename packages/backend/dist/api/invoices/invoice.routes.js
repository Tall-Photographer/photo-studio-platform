"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', auth_1.requireStaff, (req, res) => {
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
            'GET /api/v1/invoices/:id/pdf - Download PDF'
        ]
    });
});
exports.default = router;
