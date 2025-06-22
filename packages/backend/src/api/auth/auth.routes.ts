// File: packages/backend/src/api/auth/auth.routes.ts
// Authentication routes with Supabase integration

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { DatabaseService } from '../../services/database.service';
import { CacheService } from '../../services/cache.service';
import { LoggerService } from '../../services/logger.service';
import { EmailService } from '../../services/email.service';
import { authRateLimiter, passwordResetRateLimiter } from '../../middleware/rateLimiter';

const router = Router();
const database = DatabaseService.getInstance();
const cache = CacheService.getInstance();
const logger = LoggerService.getInstance();

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: 1 }).withMessage('Last name is required'),
  body('studioName').trim().isLength({ min: 1 }).withMessage('Studio name is required'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const forgotPasswordValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];

const resetPasswordValidation = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

// Interfaces
interface JwtPayload {
  userId: string;
  studioId: string;
  role: string;
  iat: number;
  exp: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

// Helper functions
const generateTokens = (userId: string, studioId: string, role: string): TokenResponse => {
  const jwtSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!jwtSecret || !refreshSecret) {
    throw new Error('JWT secrets are not configured');
  }

  const accessToken = jwt.sign(
    { userId, studioId, role },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId, studioId, role },
    refreshSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

const createStudioSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
};

/**
 * @swagger
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - firstName
 *         - lastName
 *         - studioName
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 8
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         studioName:
 *           type: string
 *         phone:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new studio and admin user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User and studio created successfully
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/register', authRateLimiter, registerValidation, async (req: Request, res: Response) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password, firstName, lastName, studioName, phone } = req.body;

    // Check if user already exists
    const existingUser = await database.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    // Generate studio slug
    let studioSlug = createStudioSlug(studioName);
    let slugAttempt = 0;
    
    // Ensure unique slug
    while (await database.findStudioBySlug(studioSlug)) {
      slugAttempt++;
      studioSlug = `${createStudioSlug(studioName)}-${slugAttempt}`;
    }

    // Hash password
    const hashedPassword = await argon2.hash(password);

    // Create studio and user in transaction
    const result = await database.getClient().$transaction(async (prisma) => {
      // Create studio
      const studio = await prisma.studio.create({
        data: {
          name: studioName,
          slug: studioSlug,
          email: email,
        },
      });

      // Generate email verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Create admin user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          role: 'STUDIO_ADMIN',
          studioId: studio.id,
          emailVerified: false,
          emailVerificationToken: verificationToken,
        },
        include: {
          studio: true,
        },
      });

      return { user, studio, verificationToken };
    });

    // Store verification token in cache
    await cache.setEmailVerificationToken(email, result.verificationToken);

    // Send verification email
    try {
      const emailService = new EmailService();
      await emailService.sendVerificationEmail(email, firstName, result.verificationToken);
    } catch (emailError) {
      logger.error('Failed to send verification email:', emailError);
      // Don't fail registration if email fails
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(
      result.user.id,
      result.studio.id,
      result.user.role
    );

    // Store refresh token
    await database.getClient().userSession.create({
      data: {
        userId: result.user.id,
        token: accessToken,
        refreshToken,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip || req.connection.remoteAddress || '',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Create audit log
    await database.createAuditLog({
      studioId: result.studio.id,
      userId: result.user.id,
      action: 'CREATE',
      entity: 'USER',
      entityId: result.user.id,
      newValues: {
        email: result.user.email,
        role: result.user.role,
        studio: result.studio.name,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info(`New user registered: ${email} for studio: ${studioName}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for verification.',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          emailVerified: result.user.emailVerified,
        },
        studio: {
          id: result.studio.id,
          name: result.studio.name,
          slug: result.studio.slug,
        },
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authRateLimiter, loginValidation, async (req: