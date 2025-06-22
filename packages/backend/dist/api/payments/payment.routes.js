"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', auth_1.requireStaff, (req, res) => {
    res.json({
        success: true,
        message: 'Payment routes - implementation in progress',
        endpoints: [
            'GET /api/v1/payments - List payments',
            'GET /api/v1/payments/:id - Get payment',
            'POST /api/v1/payments - Create payment',
            'PUT /api/v1/payments/:id - Update payment',
            'POST /api/v1/payments/:id/refund - Refund payment',
            'POST /api/v1/payments/stripe/webhook - Stripe webhook'
        ]
    });
});
exports.default = router;
