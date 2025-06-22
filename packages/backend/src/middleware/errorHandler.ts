// packages/backend/src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../services/logger.service';

const logger = LoggerService.getInstance();

interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export const errorHandler = (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal Server Error';
  let details = error.details || null;

  // Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    switch (prismaError.code) {
      case 'P2002':
        statusCode = 409;
        message = 'A record with this information already exists';
        details = prismaError.meta;
        break;
      case 'P2025':
        statusCode = 404;
        message = 'Record not found';
        break;
      case 'P2003':
        statusCode = 400;
        message = 'Invalid reference to related record';
        break;
      default:
        statusCode = 400;
        message = 'Database operation failed';
    }
  }

  // Validation errors
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Multer errors (file upload)
  if (error.name === 'MulterError') {
    statusCode = 400;
    if (error.code === 'LIMIT_FILE_SIZE') {
      message = 'File too large';
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files';
    } else {
      message = 'File upload error';
    }
  }

  // Log error
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
        user: (req as any).user?.id,
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
        user: (req as any).user?.id,
      },
    });
  }

  // Don't expose sensitive information in production
  if (process.env.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'Internal Server Error';
    details = null;
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details && { details }),
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
    }),
  });
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
  });
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
