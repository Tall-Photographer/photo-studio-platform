"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireStaff =
  exports.requireManagerOrAdmin =
  exports.requireAdmin =
  exports.requireRole =
  exports.authMiddleware =
    void 0;
const jwt = __importStar(require("jsonwebtoken"));
const database_service_1 = require("../services/database.service");
const logger_service_1 = require("../services/logger.service");
const database = database_service_1.DatabaseService.getInstance();
const logger = logger_service_1.LoggerService.getInstance();
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Access token is required",
      });
      return;
    }
    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error("JWT_SECRET is not defined");
      res.status(500).json({
        success: false,
        message: "Server configuration error",
      });
      return;
    }
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
      return;
    }
    const user = await database.findUserById(decoded.userId);
    if (!user || user.deletedAt) {
      res.status(401).json({
        success: false,
        message: "User not found or deactivated",
      });
      return;
    }
    req.user = user;
    req.studio = user.studio;
    next();
  } catch (error) {
    logger.error("Authentication error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication error",
    });
  }
};
exports.authMiddleware = authMiddleware;
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
      return;
    }
    next();
  };
};
exports.requireRole = requireRole;
exports.requireAdmin = (0, exports.requireRole)([
  "SUPER_ADMIN",
  "STUDIO_ADMIN",
]);
exports.requireManagerOrAdmin = (0, exports.requireRole)([
  "SUPER_ADMIN",
  "STUDIO_ADMIN",
  "MANAGER",
]);
exports.requireStaff = (0, exports.requireRole)([
  "SUPER_ADMIN",
  "STUDIO_ADMIN",
  "MANAGER",
  "PHOTOGRAPHER",
  "VIDEOGRAPHER",
  "ASSISTANT",
  "EDITOR",
]);
