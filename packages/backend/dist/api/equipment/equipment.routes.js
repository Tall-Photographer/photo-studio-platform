"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", auth_1.requireStaff, (req, res) => {
  res.json({
    success: true,
    message: "Equipment routes - implementation in progress",
    endpoints: [
      "GET /api/v1/equipment - List equipment",
      "GET /api/v1/equipment/:id - Get equipment",
      "POST /api/v1/equipment - Create equipment",
      "PUT /api/v1/equipment/:id - Update equipment",
      "DELETE /api/v1/equipment/:id - Delete equipment",
      "POST /api/v1/equipment/:id/checkout - Checkout equipment",
      "POST /api/v1/equipment/:id/checkin - Checkin equipment",
    ],
  });
});
exports.default = router;
