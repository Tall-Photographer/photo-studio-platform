// packages/backend/src/api/auth/auth.routes.ts
import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { DatabaseService } from '../../services/database.service';
import { CacheService } from '../../services/cache.service';
import { LoggerService } from '../../services/logger.service';
import { EmailService } from '../../services/email.service';

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

// Helper functions
const generateTokens = (userId: string, studioId: string, role: string) => {
  const jwtSecret = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

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
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new studio and admin user
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
 *               - firstName
 *               - lastName
 *               - studioName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               studioName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: User and studio created successfully
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/register', registerValidation, async (req: Request, res: Response) => {
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
    const hashedPassword = await bcrypt.hash(password);

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
        },
        include: {
          studio: true,
        },
      });

      return { user, studio };
    });

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await cache.setEmailVerificationToken(email, verificationToken);

    // Send verification email
    try {
      const emailService = new EmailService();
      await emailService.sendVerificationEmail(email, firstName, verificationToken);
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
        ip: req.ip || '',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
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
router.post('/login', loginValidation, async (req: Request, res: Response) => {
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

    const { email, password } = req.body;

    // Find user
    const user = await database.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if user is active
    if (user.deletedAt) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.verify(user.password, password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if studio is active (for non-super admins)
    if (user.role !== 'SUPER_ADMIN' && (!user.studio || user.studio.deletedAt)) {
      return res.status(401).json({
        success: false,
        message: 'Studio is not active',
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(
      user.id,
      user.studioId,
      user.role
    );

    // Store session
    await database.getClient().userSession.create({
      data: {
        userId: user.id,
        token: accessToken,
        refreshToken,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip || '',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Update last login
    await database.updateUser(user.id, {
      lastLoginAt: new Date(),
      lastLoginIp: req.ip,
      loginCount: { increment: 1 },
    });

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
        },
        studio: user.studio ? {
          id: user.studio.id,
          name: user.studio.name,
          slug: user.studio.slug,
          defaultCurrency: user.studio.defaultCurrency,
          timezone: user.studio.timezone,
        } : null,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       404:
 *         description: User not found
 */
router.post('/forgot-password', forgotPasswordValidation, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email } = req.body;

    // Find user
    const user = await database.findUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists or not
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    await cache.setPasswordResetToken(email, resetToken);

    // Send reset email
    try {
      const emailService = new EmailService();
      await emailService.sendPasswordResetEmail(email, user.firstName, resetToken);
    } catch (emailError) {
      logger.error('Failed to send password reset email:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send password reset email',
      });
    }

    logger.info(`Password reset requested for: ${email}`);

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', resetPasswordValidation, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { token, password } = req.body;

    // Find the email associated with this token
    // Note: In a real implementation, you might want to store token-email mapping differently
    // For now, we'll search through all reset tokens (not ideal for production)
    let userEmail: string | null = null;
    
    // This is a simplified approach - in production, consider storing email with token
    const user = await database.getClient().user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password);

    // Update user password
    await database.updateUser(user.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    });

    // Invalidate all user sessions
    await database.getClient().userSession.deleteMany({
      where: { userId: user.id },
    });

    // Delete reset token from cache
    await cache.deletePasswordResetToken(user.email);

    logger.info(`Password reset completed for: ${user.email}`);

    res.json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: Verify email address
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required',
      });
    }

    // Find user with this verification token
    // Similar to password reset, this is simplified
    const user = await database.getClient().user.findFirst({
      where: {
        emailVerificationToken: token,
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification token',
      });
    }

    // Update user as verified
    await database.updateUser(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
    });

    // Delete verification token from cache
    await cache.deleteEmailVerificationToken(user.email);

    logger.info(`Email verified for: ${user.email}`);

    res.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify email',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret) as any;
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    // Find session
    const session = await database.getClient().userSession.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    if (!session || session.refreshExpiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      session.user.id,
      session.user.studioId,
      session.user.role
    );

    // Update session
    await database.getClient().userSession.update({
      where: { id: session.id },
      data: {
        token: accessToken,
        refreshToken: newRefreshToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        lastActivityAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          accessToken,
          refreshToken: newRefreshToken,
        },
      },
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token',
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Delete session
      await database.getClient().userSession.deleteMany({
        where: { token },
      });
    }

    res.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
    });
  }
});

export default router;