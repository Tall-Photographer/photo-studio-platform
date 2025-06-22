"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", auth_1.requireManagerOrAdmin, (req, res) => {
  res.json({
    success: true,
    message: "User routes - implementation in progress",
    endpoints: [
      "GET /api/v1/users - List users",
      "GET /api/v1/users/:id - Get user",
      "POST /api/v1/users - Create user",
      "PUT /api/v1/users/:id - Update user",
      "DELETE /api/v1/users/:id - Delete user",
    ],
  });
});
exports.default = router;
