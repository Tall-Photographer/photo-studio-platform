"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityMiddleware = void 0;
const logger_service_1 = require("../services/logger.service");
const logger = logger_service_1.LoggerService.getInstance();
const securityMiddleware = (req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const suspiciousPatterns = [
    /\.\./,
    /script/i,
    /union.*select/i,
    /drop.*table/i,
  ];
  const url = req.url.toLowerCase();
  const body = JSON.stringify(req.body).toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url) || pattern.test(body)) {
      logger.warn("Suspicious request detected", {
        ip: req.ip,
        url: req.url,
        userAgent: req.get("User-Agent"),
      });
      break;
    }
  }
  next();
};
exports.securityMiddleware = securityMiddleware;
