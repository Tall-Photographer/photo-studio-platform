// packages/backend/src/api/auth/auth.routes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../../services/auth.service';
import { validate } from '../../middleware/validate';
import { authenticate, optionalAuth } from '../../middleware/auth';
import { rateLimiter } from '../../middleware/rateLimiter';
import {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  emailSchema,
} from '../../utils/validation';

const router = Router();
const authService = AuthService.getInstance();

// Custom rate limiters for auth endpoints
const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many authentication attempts, please try again later',
});

const passwordResetLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: 'Too many password reset attempts, please try again later',
});

// Register new user
router.post(
  '/register',
  authRateLimiter,
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.register(req.body);
      
      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Login
router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, remember } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await authService.login(email, password, ipAddress, userAgent);

      // Set secure HTTP-only cookie for refresh token
      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: remember ? 7 * 24 * 60 * 60 * 1000 : undefined, // 7 days if remember me
      });

      res.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          avatar: result.user.avatar,
          twoFactorEnabled: result.user.twoFactorEnabled,
        },
        studio: {
          id: result.studio.id,
          name: result.studio.name,
          slug: result.studio.slug,
          logo: result.studio.logo,
          defaultCurrency: result.studio.defaultCurrency,
          timezone: result.studio.timezone,
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          expiresIn: result.tokens.expiresIn,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// OAuth login
router.post(
  '/oauth/:provider',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = req.params.provider as 'google' | 'facebook' | 'apple';
      const { token, studioSlug } = req.body;
      
      if (!['google', 'facebook', 'apple'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid OAuth provider' });
      }

      // Verify OAuth token with provider
      // This would be implemented based on each provider's SDK
      const profile = await verifyOAuthToken(provider, token);

      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await authService.oauthLogin(
        provider,
        profile,
        studioSlug,
        ipAddress,
        userAgent
      );

      // Set refresh token cookie
      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          avatar: result.user.avatar,
        },
        studio: {
          id: result.studio.id,
          name: result.studio.name,
          slug: result.studio.slug,
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          expiresIn: result.tokens.expiresIn,
        },
        isNewUser: result.isNewUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Refresh token
router.post(
  '/refresh',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
      }

      const tokens = await authService.refreshToken(refreshToken);

      res.json({
        tokens: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Logout
router.post(
  '/logout',
  authenticate,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      await authService.logout(req.user.sessionId);

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Verify email
router.post(
  '/verify-email',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Verification token required' });
      }

      await authService.verifyEmail(token);

      res.json({ message: 'Email verified successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Resend verification email
router.post(
  '/resend-verification',
  authRateLimiter,
  validate(z.object({ email: emailSchema })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resendVerificationEmail(req.body.email);

      res.json({ message: 'Verification email sent' });
    } catch (error) {
      next(error);
    }
  }
);

// Request password reset
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(z.object({ email: emailSchema })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.requestPasswordReset(req.body.email);

      // Always return success to prevent email enumeration
      res.json({ 
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    } catch (error) {
      // Log error but don't expose it
      console.error('Password reset error:', error);
      res.json({ 
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    }
  }
);

// Reset password
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password } = req.body;

      await authService.resetPassword(token, password);

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Change password (authenticated)
router.post(
  '/change-password',
  authenticate,
  validate(z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8).max(100),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      await authService.changePassword(
        req.user.id,
        req.body.currentPassword,
        req.body.newPassword
      );

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// 2FA endpoints
// Setup 2FA
router.post(
  '/2fa/setup',
  authenticate,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const result = await authService.setup2FA(req.user.id);

      res.json({
        secret: result.secret,
        qrCode: result.qrCode,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Verify 2FA setup
router.post(
  '/2fa/verify-setup',
  authenticate,
  validate(z.object({ token: z.string().length(6) })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      await authService.verify2FASetup(req.user.id, req.body.token);

      res.json({ message: '2FA enabled successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Verify 2FA token during login
router.post(
  '/2fa/verify',
  validate(z.object({
    userId: idSchema,
    token: z.string().length(6),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isValid = await authService.verify2FA(req.body.userId, req.body.token);

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid 2FA token' });
      }

      res.json({ message: '2FA verified' });
    } catch (error) {
      next(error);
    }
  }
);

// Disable 2FA
router.post(
  '/2fa/disable',
  authenticate,
  validate(z.object({
    password: z.string(),
    token: z.string().length(6),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      await authService.disable2FA(req.user.id, req.body.password, req.body.token);

      res.json({ message: '2FA disabled successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Get current user
router.get(
  '/me',
  authenticate,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = await DatabaseService.getInstance().getClient().user.findUnique({
        where: { id: req.user.id },
        include: {
          studio: {
            select: {
              id: true,
              name: true,
              slug: true,
              logo: true,
              defaultCurrency: true,
              timezone: true,
              features: true,
              subscriptionStatus: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          twoFactorEnabled: user.twoFactorEnabled,
          emailVerified: user.emailVerified,
          hourlyRate: user.hourlyRate,
          skills: user.skills,
          specializations: user.specializations,
        },
        studio: user.studio,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Check if email exists (for registration flow)
router.post(
  '/check-email',
  validate(z.object({ email: emailSchema })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const exists = await DatabaseService.getInstance().getClient().user.findUnique({
        where: { email: req.body.email.toLowerCase() },
        select: { id: true },
      });

      res.json({ exists: !!exists });
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to verify OAuth tokens (simplified)
async function verifyOAuthToken(provider: string, token: string): Promise<any> {
  // This would be implemented using the respective OAuth provider's SDK
  // For now, returning a mock profile
  switch (provider) {
    case 'google':
      // Use Google OAuth2 client to verify
      return {
        id: 'google_user_id',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        avatar: 'https://example.com/avatar.jpg',
      };
    case 'facebook':
      // Use Facebook SDK to verify
      return {
        id: 'facebook_user_id',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        avatar: 'https://example.com/avatar.jpg',
      };
    case 'apple':
      // Use Apple Sign In to verify
      return {
        id: 'apple_user_id',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };
    default:
      throw new Error('Invalid OAuth provider');
  }
}

// Import required modules
import { z } from 'zod';
import { idSchema } from '../../utils/validation';
import { DatabaseService } from '../../services/database.service';

export default router;