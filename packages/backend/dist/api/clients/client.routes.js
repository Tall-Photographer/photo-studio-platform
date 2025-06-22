"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", auth_1.requireStaff, (req, res) => {
  res.json({
    success: true,
    message: "Client routes - implementation in progress",
    endpoints: [
      "GET /api/v1/clients - List clients",
      "GET /api/v1/clients/:id - Get client",
      "POST /api/v1/clients - Create client",
      "PUT /api/v1/clients/:id - Update client",
      "DELETE /api/v1/clients/:id - Delete client",
      "GET /api/v1/clients/:id/bookings - Get client bookings",
    ],
  });
});
exports.default = router;
