"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.notFoundHandler = exports.errorHandler = void 0;
const logger_service_1 = require("../services/logger.service");
const logger = logger_service_1.LoggerService.getInstance();
const errorHandler = (error, req, res, next) => {
  let statusCode = error.statusCode || 500;
  let message = error.message || "Internal Server Error";
  let details = error.details || null;
  if (error.name === "PrismaClientKnownRequestError") {
    const prismaError = error;
    switch (prismaError.code) {
      case "P2002":
        statusCode = 409;
        message = "A record with this information already exists";
        details = prismaError.meta;
        break;
      case "P2025":
        statusCode = 404;
        message = "Record not found";
        break;
      case "P2003":
        statusCode = 400;
        message = "Invalid reference to related record";
        break;
      default:
        statusCode = 400;
        message = "Database operation failed";
    }
  }
  if (error.name === "ValidationError") {
    statusCode = 400;
    message = "Validation failed";
  }
  if (error.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  }
  if (error.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }
  if (error.name === "MulterError") {
    statusCode = 400;
    if (error.code === "LIMIT_FILE_SIZE") {
      message = "File too large";
    } else if (error.code === "LIMIT_FILE_COUNT") {
      message = "Too many files";
    } else {
      message = "File upload error";
    }
  }
  if (statusCode >= 500) {
    logger.error(`Server Error: ${message}`, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      },
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        user: req.user?.id,
      },
    });
  } else {
    logger.warn(`Client Error: ${message}`, {
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
      },
      request: {
        method: req.method,
        url: req.url,
        user: req.user?.id,
      },
    });
  }
  if (process.env.NODE_ENV === "production" && statusCode >= 500) {
    message = "Internal Server Error";
    details = null;
  }
  res.status(statusCode).json({
    success: false,
    message,
    ...(details && { details }),
    ...(process.env.NODE_ENV === "development" && {
      stack: error.stack,
    }),
  });
};
exports.errorHandler = errorHandler;
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    path: req.originalUrl,
  });
};
exports.notFoundHandler = notFoundHandler;
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
exports.asyncHandler = asyncHandler;
