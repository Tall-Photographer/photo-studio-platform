"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const argon2 = __importStar(require("argon2"));
const jwt = __importStar(require("jsonwebtoken"));
const crypto = __importStar(require("crypto"));
const database_service_1 = require("../../services/database.service");
const cache_service_1 = require("../../services/cache.service");
const logger_service_1 = require("../../services/logger.service");
const email_service_1 = require("../../services/email.service");
const rateLimiter_1 = require("../../middleware/rateLimiter");
const router = (0, express_1.Router)();
const database = database_service_1.DatabaseService.getInstance();
const cache = cache_service_1.CacheService.getInstance();
const logger = logger_service_1.LoggerService.getInstance();
const registerValidation = [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    (0, express_validator_1.body)('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
    (0, express_validator_1.body)('lastName').trim().isLength({ min: 1 }).withMessage('Last name is required'),
    (0, express_validator_1.body)('studioName').trim().isLength({ min: 1 }).withMessage('Studio name is required'),
];
const loginValidation = [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password is required'),
];
const forgotPasswordValidation = [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];
const resetPasswordValidation = [
    (0, express_validator_1.body)('token').notEmpty().withMessage('Reset token is required'),
    (0, express_validator_1.body)('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];
const generateTokens = (userId, studioId, role) => {
    const jwtSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!jwtSecret || !refreshSecret) {
        throw new Error('JWT secrets are not configured');
    }
    const accessToken = jwt.sign({ userId, studioId, role }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
    const refreshToken = jwt.sign({ userId, studioId, role }, refreshSecret, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
    return { accessToken, refreshToken };
};
const createStudioSlug = (name) => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
};
router.post('/register', rateLimiter_1.authRateLimiter, registerValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array(),
            });
        }
        const { email, password, firstName, lastName, studioName, phone } = req.body;
        const existingUser = await database.findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists',
            });
        }
        let studioSlug = createStudioSlug(studioName);
        let slugAttempt = 0;
        while (await database.findStudioBySlug(studioSlug)) {
            slugAttempt++;
            studioSlug = `${createStudioSlug(studioName)}-${slugAttempt}`;
        }
        const hashedPassword = await argon2.hash(password);
        const result = await database.getClient().$transaction(async (prisma) => {
            const studio = await prisma.studio.create({
                data: {
                    name: studioName,
                    slug: studioSlug,
                    email: email,
                },
            });
            const verificationToken = crypto.randomBytes(32).toString('hex');
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
        await cache.setEmailVerificationToken(email, result.verificationToken);
        try {
            const emailService = new email_service_1.EmailService();
            await emailService.sendVerificationEmail(email, firstName, result.verificationToken);
        }
        catch (emailError) {
            logger.error('Failed to send verification email:', emailError);
        }
        const { accessToken, refreshToken } = generateTokens(result.user.id, result.studio.id, result.user.role);
        await database.getClient().userSession.create({
            data: {
                userId: result.user.id,
                token: accessToken,
                refreshToken,
                userAgent: req.get('User-Agent') || '',
                ip: req.ip || req.connection.remoteAddress || '',
                expiresAt: new Date(Date.now() + 15 * 60 * 1000),
                refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
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
    }
    catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
        });
    }
});
router.post('/login', rateLimiter_1.authRateLimiter, loginValidation, async (req) => );
