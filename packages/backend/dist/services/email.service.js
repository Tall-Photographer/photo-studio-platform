"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const nodemailer = __importStar(require("nodemailer"));
const logger_service_1 = require("./logger.service");
class EmailService {
  constructor() {
    this.logger = logger_service_1.LoggerService.getInstance();
    this.fromEmail = process.env.FROM_EMAIL || "noreply@shootlinks.com";
    this.fromName = process.env.FROM_NAME || "Shootlinks Platform";
    this.setupTransporter();
  }
  setupTransporter() {
    if (process.env.SENDGRID_API_KEY) {
      this.setupSendGrid();
    } else if (process.env.SMTP_HOST) {
      this.setupSMTP();
    } else {
      this.setupTestTransporter();
    }
  }
  setupSendGrid() {
    this.transporter = nodemailer.createTransporter({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
    this.logger.info("Email service initialized with SendGrid");
  }
  setupSMTP() {
    const config = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };
    this.transporter = nodemailer.createTransporter(config);
    this.logger.info("Email service initialized with SMTP");
  }
  setupTestTransporter() {
    this.transporter = nodemailer.createTransporter({
      streamTransport: true,
      newline: "unix",
      buffer: true,
    });
    this.logger.warn(
      "Email service initialized in test mode - emails will be logged to console",
    );
  }
  async sendEmail(to, subject, html, text) {
    try {
      const mailOptions = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to,
        subject,
        html,
        text: text || this.stripHtml(html),
      };
      const result = await this.transporter.sendMail(mailOptions);
      if (process.env.NODE_ENV === "development") {
        this.logger.debug("Email sent:", {
          to,
          subject,
          messageId: result.messageId,
        });
      } else {
        this.logger.info(`Email sent to ${to}: ${subject}`);
      }
    } catch (error) {
      this.logger.error("Failed to send email:", error);
      throw new Error("Failed to send email");
    }
  }
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, "");
  }
  async sendVerificationEmail(email, firstName, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    const subject = "Verify Your Email Address - Shootlinks";
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9fafb; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { background: #e5e7eb; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Shootlinks!</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName},</h2>
            <p>Thank you for registering with Shootlinks! To complete your account setup, please verify your email address by clicking the button below:</p>
            
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p><a href="${verificationUrl}">${verificationUrl}</a></p>
            
            <p>This verification link will expire in 24 hours for security reasons.</p>
            
            <p>If you didn't create an account with Shootlinks, you can safely ignore this email.</p>
            
            <p>Best regards,<br>The Shootlinks Team</p>
          </div>
          <div class="footer">
            <p>© 2025 Shootlinks. All rights reserved.</p>
            <p>This email was sent to ${email}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail(email, subject, html);
  }
  async sendPasswordResetEmail(email, firstName, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const subject = "Reset Your Password - Shootlinks";
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9fafb; }
          .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { background: #e5e7eb; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; }
          .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName},</h2>
            <p>We received a request to reset your password for your Shootlinks account. If you made this request, click the button below to reset your password:</p>
            
            <a href="${resetUrl}" class="button">Reset Password</a>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            
            <div class="warning">
              <strong>Important:</strong> This password reset link will expire in 1 hour for security reasons.
            </div>
            
            <p>If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
            
            <p>For security reasons, if you continue to receive these emails, please contact our support team.</p>
            
            <p>Best regards,<br>The Shootlinks Team</p>
          </div>
          <div class="footer">
            <p>© 2025 Shootlinks. All rights reserved.</p>
            <p>This email was sent to ${email}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail(email, subject, html);
  }
  async sendBookingConfirmation(email, clientName, bookingDetails) {
    const subject = `Booking Confirmation - ${bookingDetails.title}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9fafb; }
          .booking-details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
          .footer { background: #e5e7eb; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmed!</h1>
          </div>
          <div class="content">
            <h2>Hi ${clientName},</h2>
            <p>Your booking has been confirmed. Here are the details:</p>
            
            <div class="booking-details">
              <h3>${bookingDetails.title}</h3>
              <div class="detail-row">
                <span><strong>Date:</strong></span>
                <span>${new Date(bookingDetails.startDate).toLocaleDateString()}</span>
              </div>
              <div class="detail-row">
                <span><strong>Time:</strong></span>
                <span>${new Date(bookingDetails.startDate).toLocaleTimeString()} - ${new Date(bookingDetails.endDate).toLocaleTimeString()}</span>
              </div>
              <div class="detail-row">
                <span><strong>Duration:</strong></span>
                <span>${bookingDetails.duration} hours</span>
              </div>
              <div class="detail-row">
                <span><strong>Location:</strong></span>
                <span>${bookingDetails.location || "Studio"}</span>
              </div>
              <div class="detail-row">
                <span><strong>Total Amount:</strong></span>
                <span>${bookingDetails.currency} ${bookingDetails.totalAmount}</span>
              </div>
            </div>
            
            <p>We're looking forward to working with you! If you need to make any changes to your booking, please contact us as soon as possible.</p>
            
            <p>Best regards,<br>${bookingDetails.studioName}</p>
          </div>
          <div class="footer">
            <p>© 2025 ${bookingDetails.studioName}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail(email, subject, html);
  }
  async testConnection() {
    try {
      await this.transporter.verify();
      this.logger.info("Email service connection verified");
      return true;
    } catch (error) {
      this.logger.error("Email service connection failed:", error);
      return false;
    }
  }
}
exports.EmailService = EmailService;
