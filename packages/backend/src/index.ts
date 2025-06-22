// packages/backend/src/index.ts
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import { securityMiddleware } from './middleware/security';

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
import fileRoutes from './api/files/file.routes';
import notificationRoutes from './api/notifications/notification.routes';
import emailRoutes from './api/emails/email.routes';
import reportRoutes from './api/reports/report.routes';
import settingsRoutes from './api/settings/settings.routes';
import locationRoutes from './api/locations/location.routes';

// Import services
import { DatabaseService } from './services/database.service';
import { SocketService } from './services/socket.service';
import { JobQueueService } from './services/jobQueue.service';
import { CacheService } from './services/cache.service';
import { LoggerService } from './services/logger.service';
import { CronService } from './services/cron.service';

// Initialize services
const logger = LoggerService.getInstance();
const cache = CacheService.getInstance();

class Server {
  private app: Application;
  private server: any;
  private io: SocketServer;
  private redis: Redis;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.server = createServer(this.app);
    this.io = new SocketServer(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
      },
    });
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  private async initializeDatabase(): Promise<void> {
    try {
      await DatabaseService.getInstance().connect();
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Database connection failed:', error);
      process.exit(1);
    }
  }

  private configureMiddleware(): void {
    // Security
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
    }));

    // CORS
    this.app.use(cors({
      origin: (origin, callback) => {
        const allowedOrigins = [
          process.env.FRONTEND_URL || 'http://localhost:3000',
          'http://localhost:3000',
          'http://localhost:3001',
        ];

        // Allow requests with no origin (mobile apps, postman, etc)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Studio-ID'],
    }));

    // Body parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Compression
    this.app.use(compression());

    // Logging
    if (process.env.NODE_ENV !== 'test') {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => logger.info(message.trim()),
        },
      }));
    }

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting
    this.app.use('/api/', rateLimiter);

    // Security middleware
    this.app.use(securityMiddleware);

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        services: {
          database: DatabaseService.getInstance().isConnected(),
          redis: this.redis.status === 'ready',
          cache: cache.isConnected(),
        },
      });
    });
  }

  private configureRoutes(): void {
    const apiPrefix = '/api/v1';

    // Public routes
    this.app.use(`${apiPrefix}/auth`, authRoutes);
    this.app.use(`${apiPrefix}/locations`, locationRoutes);

    // Protected routes
    this.app.use(`${apiPrefix}/users`, userRoutes);
    this.app.use(`${apiPrefix}/studios`, studioRoutes);
    this.app.use(`${apiPrefix}/clients`, clientRoutes);
    this.app.use(`${apiPrefix}/bookings`, bookingRoutes);
    this.app.use(`${apiPrefix}/equipment`, equipmentRoutes);
    this.app.use(`${apiPrefix}/rooms`, roomRoutes);
    this.app.use(`${apiPrefix}/projects`, projectRoutes);
    this.app.use(`${apiPrefix}/invoices`, invoiceRoutes);
    this.app.use(`${apiPrefix}/payments`, paymentRoutes);
    this.app.use(`${apiPrefix}/files`, fileRoutes);
    this.app.use(`${apiPrefix}/notifications`, notificationRoutes);
    this.app.use(`${apiPrefix}/emails`, emailRoutes);
    this.app.use(`${apiPrefix}/reports`, reportRoutes);
    this.app.use(`${apiPrefix}/settings`, settingsRoutes);

    // API documentation
    if (process.env.NODE_ENV !== 'production') {
      this.app.get('/api-docs', (req, res) => {
        res.json({
          message: 'API Documentation',
          version: '3.0.0',
          endpoints: {
            auth: `${apiPrefix}/auth`,
            users: `${apiPrefix}/users`,
            studios: `${apiPrefix}/studios`,
            clients: `${apiPrefix}/clients`,
            bookings: `${apiPrefix}/bookings`,
            equipment: `${apiPrefix}/equipment`,
            rooms: `${apiPrefix}/rooms`,
            projects: `${apiPrefix}/projects`,
            invoices: `${apiPrefix}/invoices`,
            payments: `${apiPrefix}/payments`,
            files: `${apiPrefix}/files`,
            notifications: `${apiPrefix}/notifications`,
            emails: `${apiPrefix}/emails`,
            reports: `${apiPrefix}/reports`,
            settings: `${apiPrefix}/settings`,
            locations: `${apiPrefix}/locations`,
          },
        });
      });
    }

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource does not exist',
        path: req.originalUrl,
      });
    });

    // Error handler (must be last)
    this.app.use(errorHandler);
  }

  private configureSockets(): void {
    SocketService.initialize(this.io, this.redis);
    logger.info('Socket.IO initialized');
  }

  private async initializeServices(): Promise<void> {
    try {
      // Initialize job queue
      await JobQueueService.getInstance().initialize();
      logger.info('Job queue service initialized');

      // Initialize cron jobs
      CronService.getInstance().start();
      logger.info('Cron service started');

      // Load location data
      await this.loadLocationData();
      logger.info('Location data loaded');

    } catch (error) {
      logger.error('Service initialization failed:', error);
      throw error;
    }
  }

  private async loadLocationData(): Promise<void> {
    const db = DatabaseService.getInstance().getClient();
    
    // Check if countries are already loaded
    const countryCount = await db.country.count();
    
    if (countryCount === 0) {
      logger.info('Loading country data...');
      // This would be loaded from a comprehensive dataset
      // For now, we'll add a few key countries as examples
      
      const countries = [
        {
          code: 'US',
          code3: 'USA',
          name: 'United States',
          nativeName: 'United States',
          capital: 'Washington, D.C.',
          region: 'Americas',
          subregion: 'North America',
          phoneCode: '+1',
          phoneFormat: '^\\d{3}-\\d{3}-\\d{4}$',
          postalCodeFormat: '^\\d{5}(-\\d{4})?$',
          currencies: ['USD'],
          languages: ['en'],
          timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
        },
        {
          code: 'AE',
          code3: 'ARE',
          name: 'United Arab Emirates',
          nativeName: 'دولة الإمارات العربية المتحدة',
          capital: 'Abu Dhabi',
          region: 'Asia',
          subregion: 'Western Asia',
          phoneCode: '+971',
          phoneFormat: '^\\d{2}-\\d{7}$',
          postalCodeFormat: '^\\d*$',
          currencies: ['AED'],
          languages: ['ar', 'en'],
          timezones: ['Asia/Dubai'],
        },
        {
          code: 'GB',
          code3: 'GBR',
          name: 'United Kingdom',
          nativeName: 'United Kingdom',
          capital: 'London',
          region: 'Europe',
          subregion: 'Northern Europe',
          phoneCode: '+44',
          phoneFormat: '^\\d{4}\\s\\d{6}$',
          postalCodeFormat: '^[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}$',
          currencies: ['GBP'],
          languages: ['en'],
          timezones: ['Europe/London'],
        },
        // Add more countries as needed
      ];

      for (const country of countries) {
        await db.country.create({ data: country });
      }

      logger.info(`Loaded ${countries.length} countries`);
    }

    // Check if timezones are loaded
    const timezoneCount = await db.timezone.count();
    
    if (timezoneCount === 0) {
      logger.info('Loading timezone data...');
      
      const timezones = [
        { identifier: 'UTC', name: 'Coordinated Universal Time', abbreviation: 'UTC', utcOffset: 0 },
        { identifier: 'America/New_York', name: 'Eastern Time', abbreviation: 'EST', utcOffset: -300 },
        { identifier: 'America/Chicago', name: 'Central Time', abbreviation: 'CST', utcOffset: -360 },
        { identifier: 'America/Denver', name: 'Mountain Time', abbreviation: 'MST', utcOffset: -420 },
        { identifier: 'America/Los_Angeles', name: 'Pacific Time', abbreviation: 'PST', utcOffset: -480 },
        { identifier: 'Europe/London', name: 'Greenwich Mean Time', abbreviation: 'GMT', utcOffset: 0 },
        { identifier: 'Europe/Paris', name: 'Central European Time', abbreviation: 'CET', utcOffset: 60 },
        { identifier: 'Asia/Dubai', name: 'Gulf Standard Time', abbreviation: 'GST', utcOffset: 240 },
        { identifier: 'Asia/Tokyo', name: 'Japan Standard Time', abbreviation: 'JST', utcOffset: 540 },
        { identifier: 'Australia/Sydney', name: 'Australian Eastern Time', abbreviation: 'AEST', utcOffset: 600 },
        // Add all timezones
      ];

      for (const timezone of timezones) {
        await db.timezone.create({ data: timezone });
      }

      logger.info(`Loaded ${timezones.length} timezones`);
    }
  }

  private gracefulShutdown(): void {
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      
      this.server.close(async () => {
        logger.info('HTTP server closed');
        
        // Close database connection
        await DatabaseService.getInstance().disconnect();
        
        // Close Redis connection
        this.redis.disconnect();
        
        // Close cache connection
        await cache.disconnect();
        
        // Stop cron jobs
        CronService.getInstance().stop();
        
        // Stop job queue
        await JobQueueService.getInstance().stop();
        
        logger.info('All services stopped gracefully');
        process.exit(0);
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Initialize database
      await this.initializeDatabase();

      // Configure middleware
      this.configureMiddleware();

      // Configure routes
      this.configureRoutes();

      // Configure sockets
      this.configureSockets();

      // Initialize services
      await this.initializeServices();

      // Start server
      this.server.listen(this.port, () => {
        logger.info(`Server running on port ${this.port} in ${process.env.NODE_ENV} mode`);
        logger.info(`API available at http://localhost:${this.port}/api/v1`);
        
        if (process.env.NODE_ENV !== 'production') {
          logger.info(`API documentation available at http://localhost:${this.port}/api-docs`);
        }
      });

      // Setup graceful shutdown
      this.gracefulShutdown();

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new Server();
server.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export default server;