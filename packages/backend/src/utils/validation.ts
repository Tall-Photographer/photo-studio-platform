// packages/backend/src/utils/validation.ts
import { z } from 'zod';
import {
  UserRole,
  BookingStatus,
  ProjectStatus,
  InvoiceStatus,
  PaymentStatus,
  PaymentGateway,
  Currency,
  LocationType,
  WeatherCondition,
  EquipmentStatus,
  ExpenseCategory,
  NotificationType,
  CampaignStatus,
} from '@prisma/client';

// Common schemas
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const idSchema = z.string().cuid();

export const emailSchema = z.string().email().toLowerCase();

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
  .optional();

export const currencySchema = z.nativeEnum(Currency);

export const dateRangeSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be after start date',
  });

// Auth schemas
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(100),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phone: phoneSchema,
  studioId: idSchema,
  role: z.nativeEnum(UserRole).default('CLIENT'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
  remember: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(100),
});

// Studio schemas
export const createStudioSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  email: emailSchema,
  phone: phoneSchema,
  website: z.string().url().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().length(2).optional(),
  postalCode: z.string().optional(),
  timezone: z.string(),
  defaultCurrency: currencySchema,
  taxRate: z.number().min(0).max(100).default(0),
  taxId: z.string().optional(),
  logo: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#000000'),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#ffffff'),
  businessHours: z
    .record(
      z.object({
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
        closed: z.boolean().optional(),
      })
    )
    .optional(),
});

export const updateStudioSchema = createStudioSchema.partial();

// User schemas
export const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(100).optional(),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phone: phoneSchema,
  role: z.nativeEnum(UserRole),
  hourlyRate: z.number().positive().optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  skills: z.array(z.string()).optional(),
  specializations: z.array(z.string()).optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ email: true });

// Client schemas
export const createClientSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: emailSchema,
  phone: phoneSchema,
  company: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().length(2).optional(),
  postalCode: z.string().optional(),
  preferredContactMethod: z.enum(['email', 'phone', 'sms']).default('email'),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  marketingConsent: z.boolean().default(false),
  source: z.string().optional(),
  referredBy: z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

// Booking schemas
export const createBookingSchema = z
  .object({
    clientId: idSchema,
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    type: z.string().min(1).max(50),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),

    // Location fields
    locationType: z.nativeEnum(LocationType).default('STUDIO'),
    location: z.string().optional(),
    locationAddress: z.string().optional(),
    locationCity: z.string().optional(),
    locationState: z.string().optional(),
    locationCountry: z.string().optional(),
    locationPostalCode: z.string().optional(),
    locationLatitude: z.number().min(-90).max(90).optional(),
    locationLongitude: z.number().min(-180).max(180).optional(),
    locationNotes: z.string().optional(),
    travelTime: z.number().min(0).optional(),
    travelDistance: z.number().min(0).optional(),

    // Weather fields for outdoor shoots
    weatherRequired: z.boolean().default(false),
    preferredWeather: z.array(z.nativeEnum(WeatherCondition)).optional(),
    weatherBackupPlan: z.string().optional(),

    // Financial
    totalAmount: z.number().positive(),
    depositAmount: z.number().min(0).default(0),
    discountAmount: z.number().min(0).default(0),
    currency: currencySchema,

    // Settings
    isRecurring: z.boolean().default(false),
    recurringPattern: z
      .object({
        frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
        interval: z.number().positive(),
        endDate: z.coerce.date().optional(),
        daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
      })
      .optional(),

    bufferTimeBefore: z.number().min(0).default(0),
    bufferTimeAfter: z.number().min(0).default(0),

    // Assignments
    assignments: z
      .array(
        z.object({
          userId: idSchema,
          role: z.string(),
          isPrimary: z.boolean().default(false),
          rate: z.number().positive().optional(),
        })
      )
      .optional(),

    equipmentIds: z.array(idSchema).optional(),
    roomIds: z.array(idSchema).optional(),

    internalNotes: z.string().optional(),
    customFields: z.record(z.any()).optional(),
  })
  .refine((data) => data.endDateTime > data.startDateTime, {
    message: 'End time must be after start time',
  });

export const updateBookingSchema = createBookingSchema.partial().extend({
  status: z.nativeEnum(BookingStatus).optional(),
  cancellationReason: z.string().optional(),
});

// Equipment schemas
export const createEquipmentSchema = z.object({
  name: z.string().min(1).max(100),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  category: z.string().min(1).max(50),
  subcategory: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  purchasePrice: z.number().min(0).optional(),
  currentValue: z.number().min(0).optional(),
  currency: currencySchema,
  supplier: z.string().optional(),
  status: z.nativeEnum(EquipmentStatus).default('AVAILABLE'),
  condition: z.enum(['Excellent', 'Good', 'Fair', 'Poor']).default('Good'),
  defaultLocation: z.string().optional(),
  specifications: z.record(z.any()).optional(),
  accessories: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  imageUrl: z.string().url().optional(),
  isRentable: z.boolean().default(false),
  rentalPricePerDay: z.number().min(0).optional(),
  rentalDeposit: z.number().min(0).optional(),
});

export const updateEquipmentSchema = createEquipmentSchema.partial();

// Room schemas
export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  capacity: z.number().positive(),
  pricePerHour: z.number().positive(),
  pricePerHalfDay: z.number().positive().optional(),
  pricePerFullDay: z.number().positive().optional(),
  currency: currencySchema,
  area: z.number().positive().optional(),
  features: z.array(z.string()).optional(),
  permanentEquipment: z.array(z.string()).optional(),
  minimumBookingHours: z.number().positive().default(1),
  hasNaturalLight: z.boolean().default(false),
  hasBlackoutOption: z.boolean().default(false),
  hasAirConditioning: z.boolean().default(true),
  hasHeating: z.boolean().default(true),
  accessInstructions: z.string().optional(),
  rules: z.string().optional(),
  images: z.array(z.string().url()).optional(),
});

export const updateRoomSchema = createRoomSchema.partial();

// Project schemas
export const createProjectSchema = z.object({
  clientId: idSchema,
  bookingId: idSchema.optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.string().min(1).max(50),
  shootDeadline: z.coerce.date().optional(),
  editingDeadline: z.coerce.date().optional(),
  deliveryDeadline: z.coerce.date().optional(),
  deliveryMethod: z.string().optional(),
  deliveryNotes: z.string().optional(),
  assignments: z
    .array(
      z.object({
        userId: idSchema,
        role: z.string(),
        estimatedHours: z.number().positive().optional(),
      })
    )
    .optional(),
  editorId: idSchema.optional(),
  internalNotes: z.string().optional(),
  clientNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.nativeEnum(ProjectStatus).optional(),
});

// Invoice schemas
export const createInvoiceSchema = z.object({
  clientId: idSchema,
  bookingId: idSchema.optional(),
  issueDate: z.coerce.date().default(() => new Date()),
  dueDate: z.coerce.date(),
  lineItems: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
        taxable: z.boolean().default(true),
        category: z.string().optional(),
      })
    )
    .min(1),
  discountPercentage: z.number().min(0).max(100).default(0),
  discountAmount: z.number().min(0).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  currency: currencySchema,
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  customFields: z.record(z.any()).optional(),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  status: z.nativeEnum(InvoiceStatus).optional(),
});

// Payment schemas
export const createPaymentSchema = z.object({
  clientId: idSchema,
  invoiceId: idSchema.optional(),
  bookingId: idSchema.optional(),
  amount: z.number().positive(),
  currency: currencySchema,
  gateway: z.nativeEnum(PaymentGateway),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const processPaymentSchema = z.object({
  paymentMethodId: z.string(),
  saveCard: z.boolean().default(false),
});

// File schemas
export const uploadFileSchema = z.object({
  projectId: idSchema,
  clientId: idSchema.optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// Email schemas
export const sendEmailSchema = z.object({
  to: z.array(emailSchema).min(1),
  subject: z.string().min(1).max(200),
  htmlContent: z.string(),
  textContent: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(),
        contentType: z.string(),
      })
    )
    .optional(),
});

export const createEmailCampaignSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1).max(200),
  fromName: z.string().min(1).max(50),
  fromEmail: emailSchema,
  replyTo: emailSchema.optional(),
  htmlContent: z.string(),
  textContent: z.string().optional(),
  audienceFilter: z
    .object({
      tags: z.array(z.string()).optional(),
      minBookings: z.number().min(0).optional(),
      maxBookings: z.number().min(0).optional(),
      minSpent: z.number().min(0).optional(),
      maxSpent: z.number().min(0).optional(),
      hasMarketingConsent: z.boolean().optional(),
      lastBookingBefore: z.coerce.date().optional(),
      lastBookingAfter: z.coerce.date().optional(),
    })
    .optional(),
  testEmails: z.array(emailSchema).optional(),
  scheduledFor: z.coerce.date().optional(),
  tags: z.array(z.string()).optional(),
});

// Expense schemas
export const createExpenseSchema = z.object({
  category: z.nativeEnum(ExpenseCategory),
  description: z.string().min(1),
  amount: z.number().positive(),
  currency: currencySchema,
  expenseDate: z.coerce.date(),
  vendor: z.string().optional(),
  projectReference: z.string().optional(),
  isReimbursable: z.boolean().default(false),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

// Settings schemas
export const updateSettingSchema = z.object({
  value: z.any(),
  description: z.string().optional(),
});

// Location schemas
export const searchLocationsSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['country', 'state', 'city', 'timezone']).optional(),
  countryCode: z.string().length(2).optional(),
  stateCode: z.string().optional(),
});

// Report schemas
export const reportFiltersSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  groupBy: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  clientId: idSchema.optional(),
  photographerId: idSchema.optional(),
  projectType: z.string().optional(),
  status: z.string().optional(),
});
