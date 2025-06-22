// packages/backend/src/index.ts
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Import services
import { DatabaseService } from './services/database.service';
import { LoggerService } from './services/logger.service';
import { CacheService } from './services/cache.service';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { authMiddleware } from './middleware/auth';

// Import routes
import authRoutes from './api/auth/auth.routes';
import userRoutes from './api/users/user.routes';
import studioRoutes from './api/studios/studio.routes';
import clientRoutes from './api/clients/client.routes';
import bookingRoutes from './api/bookings/booking.routes';
import equipmentRoutes from './api/equipment/equipment.routes';
import roomRoutes from './api/rooms/room.routes';
import projectRoutes from './api/projects/project.routes';
import invoiceRoutes from './api/invoices/invoice.routes';
import paymentRoutes from './api/payments/payment.routes';

// Initialize services
const logger = LoggerService.getInstance();
const database = DatabaseService.getInstance();
const cache = CacheService.getInstance();

class Server {
  private app: Application;
  private httpServer: any;
  private io: SocketServer;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.httpServer = createServer(this.app);
    
    // Initialize Socket.IO
    this.io = new SocketServer(this.httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.setupSocketHandlers();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression and logging
    this.app.use(compression());
    this.app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

    // Body parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Rate limiting
    this.app.use(rateLimiter);

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
      });
    });
  }

  private setupRoutes(): void {
    const apiPrefix = '/api/v1';

    // Public routes (no authentication required)
    this.app.use(`${apiPrefix}/auth`, authRoutes);

    // Protected routes (authentication required)
    this.app.use(`${apiPrefix}/users`, authMiddleware, userRoutes);
    this.app.use(`${apiPrefix}/studios`, authMiddleware, studioRoutes);
    this.app.use(`${apiPrefix}/clients`, authMiddleware, clientRoutes);
    this.app.use(`${apiPrefix}/bookings`, authMiddleware, bookingRoutes);
    this.app.use(`${apiPrefix}/equipment`, authMiddleware, equipmentRoutes);
    this.app.use(`${apiPrefix}/rooms`, authMiddleware, roomRoutes);
    this.app.use(`${apiPrefix}/projects`, authMiddleware, projectRoutes);
    this.app.use(`${apiPrefix}/invoices`, authMiddleware, invoiceRoutes);
    this.app.use(`${apiPrefix}/payments`, authMiddleware, paymentRoutes);

    // API documentation
    if (process.env.NODE_ENV === 'development') {
      this.setupApiDocs();
    }

    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
      });
    });
  }

  private setupApiDocs(): void {
    // Import Swagger dependencies dynamically for development only
    const swaggerJsdoc = require('swagger-jsdoc');
    const swaggerUi = require('swagger-ui-express');

    const options = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'Shootlinks V3 API',
          version: '3.0.0',
          description: 'Photography Studio Management Platform API',
        },
        servers: [
          {
            url: process.env.BACKEND_URL || 'http://localhost:3001',
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
      apis: ['./src/api/**/*.routes.ts', './src/api/**/*.ts'],
    };

    const specs = swaggerJsdoc(options);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Join studio room for real-time updates
      socket.on('join:studio', (studioId: string) => {
        socket.join(`studio:${studioId}`);
        logger.debug(`Socket ${socket.id} joined studio room: ${studioId}`);
      });

      // Handle booking updates
      socket.on('booking:update', (data) => {
        socket.to(`studio:${data.studioId}`).emit('booking:updated', data);
      });

      // Handle project updates
      socket.on('project:update', (data) => {
        socket.to(`studio:${data.studioId}`).emit('project:updated', data);
      });

      // Handle notifications
      socket.on('notification:send', (data) => {
        socket.to(`studio:${data.studioId}`).emit('notification:received', data);
      });

      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Connect to database
      await database.connect();
      logger.info('✅ Database connected successfully');

      // Connect to cache
      await cache.connect();
      logger.info('✅ Cache connected successfully');

      // Start server
      this.httpServer.listen(this.port, () => {
        logger.info(`🚀 Server running on port ${this.port}`);
        logger.info(`📖 API Documentation: http://localhost:${this.port}/api-docs`);
        logger.info(`🔍 Health Check: http://localhost:${this.port}/health`);
        logger.info(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      });

      // Graceful shutdown handling
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);

      // Close HTTP server
      this.httpServer.close(() => {
        logger.info('✅ HTTP server closed');
      });

      // Close Socket.IO server
      this.io.close(() => {
        logger.info('✅ Socket.IO server closed');
      });

      // Disconnect from database
      await database.disconnect();
      logger.info('✅ Database disconnected');

      // Disconnect from cache
      await cache.disconnect();
      logger.info('✅ Cache disconnected');

      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Start the server
const server = new Server();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
server.start().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});