// packages/backend/src/services/auth.service.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { User, UserRole, Studio } from '@prisma/client';
import { DatabaseService } from './database.service';
import { EmailService } from './email.service';
import { CacheService } from './cache.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';

interface JWTPayload {
  userId: string;
  studioId: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface LoginAttempt {
  email: string;
  attempts: number;
  lastAttempt: Date;
  lockedUntil?: Date;
}

export class AuthService {
  private static instance: AuthService;
  private db = DatabaseService.getInstance().getClient();
  private emailService = EmailService.getInstance();
  private cache = CacheService.getInstance();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();

  // Security constants
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '15m';
  private readonly REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  private readonly BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // User Registration
  public async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    studioId: string;
    role: UserRole;
    phone?: string;
  }): Promise<User> {
    // Validate password strength
    this.validatePasswordStrength(data.password);

    // Check if user already exists
    const existingUser = await this.db.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Validate studio exists and check user limit
    const studio = await this.db.studio.findUnique({
      where: { id: data.studioId },
      include: { _count: { select: { users: true } } },
    });

    if (!studio) {
      throw new Error('Invalid studio');
    }

    if (studio._count.users >= studio.maxUsers) {
      throw new Error('Studio has reached maximum user limit');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, this.BCRYPT_ROUNDS);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create user
    const user = await this.db.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        studioId: data.studioId,
        role: data.role,
        phone: data.phone,
        emailVerificationToken,
      },
    });

    // Send verification email
    await this.emailService.sendEmailVerification(user.email, emailVerificationToken);

    // Audit log
    await this.auditService.log({
      studioId: data.studioId,
      userId: user.id,
      action: 'USER_REGISTERED',
      entity: 'User',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return user;
  }

  // User Login
  public async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: User; tokens: AuthTokens; studio: Studio }> {
    const loginEmail = email.toLowerCase();

    // Check login attempts
    await this.checkLoginAttempts(loginEmail);

    // Find user with studio
    const user = await this.db.user.findUnique({
      where: { email: loginEmail },
      include: { studio: true },
    });

    if (!user || user.deletedAt) {
      await this.recordFailedLogin(loginEmail);
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password || '');
    if (!isValidPassword) {
      await this.recordFailedLogin(loginEmail);
      throw new Error('Invalid email or password');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new Error('Please verify your email before logging in');
    }

    // Check if studio is active
    if (user.studio.subscriptionStatus === 'cancelled' || user.studio.deletedAt) {
      throw new Error('Studio account is not active');
    }

    // Clear login attempts
    await this.clearLoginAttempts(loginEmail);

    // Generate tokens
    const tokens = await this.generateAuthTokens(user, ipAddress, userAgent);

    // Update last login
    await this.db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
        loginCount: { increment: 1 },
      },
    });

    // Audit log
    await this.auditService.log({
      studioId: user.studioId,
      userId: user.id,
      action: 'USER_LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return { user, tokens, studio: user.studio };
  }

  // OAuth Login
  public async oauthLogin(
    provider: 'google' | 'facebook' | 'apple',
    profile: {
      id: string;
      email: string;
      firstName?: string;
      lastName?: string;
      avatar?: string;
    },
    studioSlug: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: User; tokens: AuthTokens; studio: Studio; isNewUser: boolean }> {
    // Find studio by slug
    const studio = await this.db.studio.findUnique({
      where: { slug: studioSlug },
    });

    if (!studio) {
      throw new Error('Invalid studio');
    }

    // Find or create user
    let user = await this.db.user.findFirst({
      where: {
        email: profile.email.toLowerCase(),
        studioId: studio.id,
      },
    });

    let isNewUser = false;

    if (!user) {
      // Check studio user limit
      const userCount = await this.db.user.count({
        where: { studioId: studio.id },
      });

      if (userCount >= studio.maxUsers) {
        throw new Error('Studio has reached maximum user limit');
      }

      // Create new user
      user = await this.db.user.create({
        data: {
          email: profile.email.toLowerCase(),
          firstName: profile.firstName || 'User',
          lastName: profile.lastName || '',
          avatar: profile.avatar,
          studioId: studio.id,
          role: 'CLIENT', // Default role for OAuth users
          emailVerified: true, // OAuth emails are pre-verified
          [`${provider}Id`]: profile.id,
        },
      });

      isNewUser = true;
    } else {
      // Update OAuth ID if not set
      if (!user[`${provider}Id`]) {
        user = await this.db.user.update({
          where: { id: user.id },
          data: { [`${provider}Id`]: profile.id },
        });
      }
    }

    // Generate tokens
    const tokens = await this.generateAuthTokens(user, ipAddress, userAgent);

    // Update last login
    await this.db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
        loginCount: { increment: 1 },
      },
    });

    return { user, tokens, studio, isNewUser };
  }

  // Generate Auth Tokens
  private async generateAuthTokens(
    user: User,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuthTokens> {
    // Create session
    const session = await this.db.userSession.create({
      data: {
        userId: user.id,
        token: crypto.randomBytes(32).toString('hex'),
        refreshToken: crypto.randomBytes(32).toString('hex'),
        ip: ipAddress,
        userAgent,
        expiresAt: this.getTokenExpiry(this.TOKEN_EXPIRY),
        refreshExpiresAt: this.getTokenExpiry(this.REFRESH_TOKEN_EXPIRY),
      },
    });

    // JWT payload
    const payload: JWTPayload = {
      userId: user.id,
      studioId: user.studioId,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };

    // Generate tokens
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: this.TOKEN_EXPIRY,
    });

    const refreshToken = jwt.sign(
      { sessionId: session.id },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY }
    );

    // Cache session
    await this.cache.set(
      `session:${session.token}`,
      { userId: user.id, studioId: user.studioId, role: user.role },
      this.getExpiryInSeconds(this.TOKEN_EXPIRY)
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.getExpiryInSeconds(this.TOKEN_EXPIRY),
    };
  }

  // Refresh Token
  public async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as {
        sessionId: string;
      };

      // Find session
      const session = await this.db.userSession.findUnique({
        where: { id: decoded.sessionId },
        include: { user: true },
      });

      if (!session || session.refreshExpiresAt < new Date()) {
        throw new Error('Invalid refresh token');
      }

      // Generate new tokens
      return this.generateAuthTokens(session.user, session.ip || undefined, session.userAgent || undefined);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Logout
  public async logout(sessionId: string): Promise<void> {
    const session = await this.db.userSession.findUnique({
      where: { id: sessionId },
    });

    if (session) {
      // Delete session
      await this.db.userSession.delete({
        where: { id: sessionId },
      });

      // Remove from cache
      await this.cache.delete(`session:${session.token}`);

      // Audit log
      await this.auditService.log({
        studioId: session.user.studioId,
        userId: session.userId,
        action: 'USER_LOGOUT',
        entity: 'User',
        entityId: session.userId,
      });
    }
  }

  // Verify Email
  public async verifyEmail(token: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new Error('Invalid verification token');
    }

    await this.db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
      },
    });

    // Send welcome email
    await this.emailService.sendWelcomeEmail(user.email, user.firstName);
  }

  // Password Reset Request
  public async requestPasswordReset(email: string): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      await this.db.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpires: resetExpires,
        },
      });

      await this.emailService.sendPasswordResetEmail(user.email, resetToken);
    }

    // Always return success to prevent email enumeration
  }

  // Reset Password
  public async resetPassword(token: string, newPassword: string): Promise<void> {
    this.validatePasswordStrength(newPassword);

    const user = await this.db.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    await this.db.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Invalidate all sessions
    await this.db.userSession.deleteMany({
      where: { userId: user.id },
    });

    await this.emailService.sendPasswordChangedEmail(user.email);
  }

  // 2FA Setup
  public async setup2FA(userId: string): Promise<{ secret: string; qrCode: string }> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { studio: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const secret = speakeasy.generateSecret({
      name: `${user.studio.name} (${user.email})`,
      issuer: process.env.MFA_ISSUER || 'Shootlinks',
    });

    // Temporarily store secret
    await this.cache.set(`2fa_setup:${userId}`, secret.base32, 300); // 5 minutes

    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    return { secret: secret.base32, qrCode };
  }

  // Verify 2FA Setup
  public async verify2FASetup(userId: string, token: string): Promise<void> {
    const tempSecret = await this.cache.get(`2fa_setup:${userId}`);
    
    if (!tempSecret) {
      throw new Error('2FA setup expired');
    }

    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (!verified) {
      throw new Error('Invalid 2FA token');
    }

    await this.db.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: tempSecret,
      },
    });

    await this.cache.delete(`2fa_setup:${userId}`);
  }

  // Verify 2FA Token
  public async verify2FA(userId: string, token: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });

    if (!user?.twoFactorSecret) {
      return false;
    }

    return speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });
  }

  // Helper Methods
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one number');
    }
  }

  private async checkLoginAttempts(email: string): Promise<void> {
    const key = `login_attempts:${email}`;
    const attempts = await this.cache.get<LoginAttempt>(key);

    if (attempts && attempts.lockedUntil && attempts.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (attempts.lockedUntil.getTime() - Date.now()) / 60000
      );
      throw new Error(`Account locked. Try again in ${minutesLeft} minutes`);
    }
  }

  private async recordFailedLogin(email: string): Promise<void> {
    const key = `login_attempts:${email}`;
    const attempts = await this.cache.get<LoginAttempt>(key) || {
      email,
      attempts: 0,
      lastAttempt: new Date(),
    };

    attempts.attempts += 1;
    attempts.lastAttempt = new Date();

    if (attempts.attempts >= this.MAX_LOGIN_ATTEMPTS) {
      attempts.lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION);
    }

    await this.cache.set(key, attempts, this.LOCKOUT_DURATION / 1000);
  }

  private async clearLoginAttempts(email: string): Promise<void> {
    await this.cache.delete(`login_attempts:${email}`);
  }

  private getTokenExpiry(duration: string): Date {
    const now = new Date();
    const match = duration.match(/^(\d+)([smhd])$/);
    
    if (!match) {
      throw new Error('Invalid duration format');
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 3600; // Default 1 hour
    }
  }
}
    const unit = match[2];

    switch (unit) {
      case 's':
        now.setSeconds(now.getSeconds() + value);
        break;
      case 'm':
        now.setMinutes(now.getMinutes() + value);
        break;
      case 'h':
        now.setHours(now.getHours() + value);
        break;
      case 'd':
        now.setDate(now.getDate() + value);
        break;
    }

    return now;
  }

  private getExpiryInSeconds(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    
    if (!match) {
      throw new Error('Invalid duration format');
    }

    const value = parseInt(match[1], 10);