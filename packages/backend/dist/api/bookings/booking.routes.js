"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", auth_1.requireStaff, (req, res) => {
  res.json({
    success: true,
    message: "Booking routes - implementation in progress",
    endpoints: [
      "GET /api/v1/bookings - List bookings",
      "GET /api/v1/bookings/:id - Get booking",
      "POST /api/v1/bookings - Create booking",
      "PUT /api/v1/bookings/:id - Update booking",
      "DELETE /api/v1/bookings/:id - Cancel booking",
      "GET /api/v1/bookings/calendar - Calendar view",
    ],
  });
});
exports.default = router;
