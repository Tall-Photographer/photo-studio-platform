"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportFiltersSchema =
  exports.searchLocationsSchema =
  exports.updateSettingSchema =
  exports.updateExpenseSchema =
  exports.createExpenseSchema =
  exports.createEmailCampaignSchema =
  exports.sendEmailSchema =
  exports.uploadFileSchema =
  exports.processPaymentSchema =
  exports.createPaymentSchema =
  exports.updateInvoiceSchema =
  exports.createInvoiceSchema =
  exports.updateProjectSchema =
  exports.createProjectSchema =
  exports.updateRoomSchema =
  exports.createRoomSchema =
  exports.updateEquipmentSchema =
  exports.createEquipmentSchema =
  exports.updateBookingSchema =
  exports.createBookingSchema =
  exports.updateClientSchema =
  exports.createClientSchema =
  exports.updateUserSchema =
  exports.createUserSchema =
  exports.updateStudioSchema =
  exports.createStudioSchema =
  exports.resetPasswordSchema =
  exports.loginSchema =
  exports.registerSchema =
  exports.dateRangeSchema =
  exports.currencySchema =
  exports.phoneSchema =
  exports.emailSchema =
  exports.idSchema =
  exports.paginationSchema =
    void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.paginationSchema = zod_1.z.object({
  page: zod_1.z.coerce.number().min(1).default(1),
  limit: zod_1.z.coerce.number().min(1).max(100).default(20),
  sortBy: zod_1.z.string().optional(),
  sortOrder: zod_1.z.enum(["asc", "desc"]).default("desc"),
});
exports.idSchema = zod_1.z.string().cuid();
exports.emailSchema = zod_1.z.string().email().toLowerCase();
exports.phoneSchema = zod_1.z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format")
  .optional();
exports.currencySchema = zod_1.z.nativeEnum(client_1.Currency);
exports.dateRangeSchema = zod_1.z
  .object({
    startDate: zod_1.z.coerce.date(),
    endDate: zod_1.z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be after start date",
  });
exports.registerSchema = zod_1.z.object({
  email: exports.emailSchema,
  password: zod_1.z.string().min(8).max(100),
  firstName: zod_1.z.string().min(1).max(50),
  lastName: zod_1.z.string().min(1).max(50),
  phone: exports.phoneSchema,
  studioId: exports.idSchema,
  role: zod_1.z.nativeEnum(client_1.UserRole).default("CLIENT"),
});
exports.loginSchema = zod_1.z.object({
  email: exports.emailSchema,
  password: zod_1.z.string(),
  remember: zod_1.z.boolean().optional(),
});
exports.resetPasswordSchema = zod_1.z.object({
  token: zod_1.z.string(),
  password: zod_1.z.string().min(8).max(100),
});
exports.createStudioSchema = zod_1.z.object({
  name: zod_1.z.string().min(1).max(100),
  slug: zod_1.z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must contain only lowercase letters, numbers, and hyphens",
    ),
  email: exports.emailSchema,
  phone: exports.phoneSchema,
  website: zod_1.z.string().url().optional(),
  address: zod_1.z.string().optional(),
  city: zod_1.z.string().optional(),
  state: zod_1.z.string().optional(),
  country: zod_1.z.string().length(2).optional(),
  postalCode: zod_1.z.string().optional(),
  timezone: zod_1.z.string(),
  defaultCurrency: exports.currencySchema,
  taxRate: zod_1.z.number().min(0).max(100).default(0),
  taxId: zod_1.z.string().optional(),
  logo: zod_1.z.string().url().optional(),
  primaryColor: zod_1.z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#000000"),
  secondaryColor: zod_1.z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#ffffff"),
  businessHours: zod_1.z
    .record(
      zod_1.z.object({
        open: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
        close: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
        closed: zod_1.z.boolean().optional(),
      }),
    )
    .optional(),
});
exports.updateStudioSchema = exports.createStudioSchema.partial();
exports.createUserSchema = zod_1.z.object({
  email: exports.emailSchema,
  password: zod_1.z.string().min(8).max(100).optional(),
  firstName: zod_1.z.string().min(1).max(50),
  lastName: zod_1.z.string().min(1).max(50),
  phone: exports.phoneSchema,
  role: zod_1.z.nativeEnum(client_1.UserRole),
  hourlyRate: zod_1.z.number().positive().optional(),
  commissionRate: zod_1.z.number().min(0).max(100).optional(),
  skills: zod_1.z.array(zod_1.z.string()).optional(),
  specializations: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.updateUserSchema = exports.createUserSchema
  .partial()
  .omit({ email: true });
exports.createClientSchema = zod_1.z.object({
  firstName: zod_1.z.string().min(1).max(50),
  lastName: zod_1.z.string().min(1).max(50),
  email: exports.emailSchema,
  phone: exports.phoneSchema,
  company: zod_1.z.string().optional(),
  address: zod_1.z.string().optional(),
  city: zod_1.z.string().optional(),
  state: zod_1.z.string().optional(),
  country: zod_1.z.string().length(2).optional(),
  postalCode: zod_1.z.string().optional(),
  preferredContactMethod: zod_1.z
    .enum(["email", "phone", "sms"])
    .default("email"),
  notes: zod_1.z.string().optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
  marketingConsent: zod_1.z.boolean().default(false),
  source: zod_1.z.string().optional(),
  referredBy: zod_1.z.string().optional(),
});
exports.updateClientSchema = exports.createClientSchema.partial();
exports.createBookingSchema = zod_1.z
  .object({
    clientId: exports.idSchema,
    title: zod_1.z.string().min(1).max(200),
    description: zod_1.z.string().optional(),
    type: zod_1.z.string().min(1).max(50),
    startDateTime: zod_1.z.coerce.date(),
    endDateTime: zod_1.z.coerce.date(),
    locationType: zod_1.z.nativeEnum(client_1.LocationType).default("STUDIO"),
    location: zod_1.z.string().optional(),
    locationAddress: zod_1.z.string().optional(),
    locationCity: zod_1.z.string().optional(),
    locationState: zod_1.z.string().optional(),
    locationCountry: zod_1.z.string().optional(),
    locationPostalCode: zod_1.z.string().optional(),
    locationLatitude: zod_1.z.number().min(-90).max(90).optional(),
    locationLongitude: zod_1.z.number().min(-180).max(180).optional(),
    locationNotes: zod_1.z.string().optional(),
    travelTime: zod_1.z.number().min(0).optional(),
    travelDistance: zod_1.z.number().min(0).optional(),
    weatherRequired: zod_1.z.boolean().default(false),
    preferredWeather: zod_1.z
      .array(zod_1.z.nativeEnum(client_1.WeatherCondition))
      .optional(),
    weatherBackupPlan: zod_1.z.string().optional(),
    totalAmount: zod_1.z.number().positive(),
    depositAmount: zod_1.z.number().min(0).default(0),
    discountAmount: zod_1.z.number().min(0).default(0),
    currency: exports.currencySchema,
    isRecurring: zod_1.z.boolean().default(false),
    recurringPattern: zod_1.z
      .object({
        frequency: zod_1.z.enum(["daily", "weekly", "monthly", "yearly"]),
        interval: zod_1.z.number().positive(),
        endDate: zod_1.z.coerce.date().optional(),
        daysOfWeek: zod_1.z.array(zod_1.z.number().min(0).max(6)).optional(),
      })
      .optional(),
    bufferTimeBefore: zod_1.z.number().min(0).default(0),
    bufferTimeAfter: zod_1.z.number().min(0).default(0),
    assignments: zod_1.z
      .array(
        zod_1.z.object({
          userId: exports.idSchema,
          role: zod_1.z.string(),
          isPrimary: zod_1.z.boolean().default(false),
          rate: zod_1.z.number().positive().optional(),
        }),
      )
      .optional(),
    equipmentIds: zod_1.z.array(exports.idSchema).optional(),
    roomIds: zod_1.z.array(exports.idSchema).optional(),
    internalNotes: zod_1.z.string().optional(),
    customFields: zod_1.z.record(zod_1.z.any()).optional(),
  })
  .refine((data) => data.endDateTime > data.startDateTime, {
    message: "End time must be after start time",
  });
exports.updateBookingSchema = exports.createBookingSchema.partial().extend({
  status: zod_1.z.nativeEnum(client_1.BookingStatus).optional(),
  cancellationReason: zod_1.z.string().optional(),
});
exports.createEquipmentSchema = zod_1.z.object({
  name: zod_1.z.string().min(1).max(100),
  brand: zod_1.z.string().optional(),
  model: zod_1.z.string().optional(),
  serialNumber: zod_1.z.string().optional(),
  category: zod_1.z.string().min(1).max(50),
  subcategory: zod_1.z.string().optional(),
  purchaseDate: zod_1.z.coerce.date().optional(),
  purchasePrice: zod_1.z.number().min(0).optional(),
  currentValue: zod_1.z.number().min(0).optional(),
  currency: exports.currencySchema,
  supplier: zod_1.z.string().optional(),
  status: zod_1.z.nativeEnum(client_1.EquipmentStatus).default("AVAILABLE"),
  condition: zod_1.z
    .enum(["Excellent", "Good", "Fair", "Poor"])
    .default("Good"),
  defaultLocation: zod_1.z.string().optional(),
  specifications: zod_1.z.record(zod_1.z.any()).optional(),
  accessories: zod_1.z.array(zod_1.z.string()).optional(),
  notes: zod_1.z.string().optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
  imageUrl: zod_1.z.string().url().optional(),
  isRentable: zod_1.z.boolean().default(false),
  rentalPricePerDay: zod_1.z.number().min(0).optional(),
  rentalDeposit: zod_1.z.number().min(0).optional(),
});
exports.updateEquipmentSchema = exports.createEquipmentSchema.partial();
exports.createRoomSchema = zod_1.z.object({
  name: zod_1.z.string().min(1).max(100),
  description: zod_1.z.string().optional(),
  capacity: zod_1.z.number().positive(),
  pricePerHour: zod_1.z.number().positive(),
  pricePerHalfDay: zod_1.z.number().positive().optional(),
  pricePerFullDay: zod_1.z.number().positive().optional(),
  currency: exports.currencySchema,
  area: zod_1.z.number().positive().optional(),
  features: zod_1.z.array(zod_1.z.string()).optional(),
  permanentEquipment: zod_1.z.array(zod_1.z.string()).optional(),
  minimumBookingHours: zod_1.z.number().positive().default(1),
  hasNaturalLight: zod_1.z.boolean().default(false),
  hasBlackoutOption: zod_1.z.boolean().default(false),
  hasAirConditioning: zod_1.z.boolean().default(true),
  hasHeating: zod_1.z.boolean().default(true),
  accessInstructions: zod_1.z.string().optional(),
  rules: zod_1.z.string().optional(),
  images: zod_1.z.array(zod_1.z.string().url()).optional(),
});
exports.updateRoomSchema = exports.createRoomSchema.partial();
exports.createProjectSchema = zod_1.z.object({
  clientId: exports.idSchema,
  bookingId: exports.idSchema.optional(),
  name: zod_1.z.string().min(1).max(200),
  description: zod_1.z.string().optional(),
  type: zod_1.z.string().min(1).max(50),
  shootDeadline: zod_1.z.coerce.date().optional(),
  editingDeadline: zod_1.z.coerce.date().optional(),
  deliveryDeadline: zod_1.z.coerce.date().optional(),
  deliveryMethod: zod_1.z.string().optional(),
  deliveryNotes: zod_1.z.string().optional(),
  assignments: zod_1.z
    .array(
      zod_1.z.object({
        userId: exports.idSchema,
        role: zod_1.z.string(),
        estimatedHours: zod_1.z.number().positive().optional(),
      }),
    )
    .optional(),
  editorId: exports.idSchema.optional(),
  internalNotes: zod_1.z.string().optional(),
  clientNotes: zod_1.z.string().optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
  customFields: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.updateProjectSchema = exports.createProjectSchema.partial().extend({
  status: zod_1.z.nativeEnum(client_1.ProjectStatus).optional(),
});
exports.createInvoiceSchema = zod_1.z.object({
  clientId: exports.idSchema,
  bookingId: exports.idSchema.optional(),
  issueDate: zod_1.z.coerce.date().default(() => new Date()),
  dueDate: zod_1.z.coerce.date(),
  lineItems: zod_1.z
    .array(
      zod_1.z.object({
        description: zod_1.z.string().min(1),
        quantity: zod_1.z.number().positive(),
        unitPrice: zod_1.z.number().positive(),
        taxable: zod_1.z.boolean().default(true),
        category: zod_1.z.string().optional(),
      }),
    )
    .min(1),
  discountPercentage: zod_1.z.number().min(0).max(100).default(0),
  discountAmount: zod_1.z.number().min(0).default(0),
  taxRate: zod_1.z.number().min(0).max(100).default(0),
  currency: exports.currencySchema,
  paymentTerms: zod_1.z.string().optional(),
  notes: zod_1.z.string().optional(),
  customFields: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.updateInvoiceSchema = exports.createInvoiceSchema.partial().extend({
  status: zod_1.z.nativeEnum(client_1.InvoiceStatus).optional(),
});
exports.createPaymentSchema = zod_1.z.object({
  clientId: exports.idSchema,
  invoiceId: exports.idSchema.optional(),
  bookingId: exports.idSchema.optional(),
  amount: zod_1.z.number().positive(),
  currency: exports.currencySchema,
  gateway: zod_1.z.nativeEnum(client_1.PaymentGateway),
  description: zod_1.z.string().optional(),
  metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.processPaymentSchema = zod_1.z.object({
  paymentMethodId: zod_1.z.string(),
  saveCard: zod_1.z.boolean().default(false),
});
exports.uploadFileSchema = zod_1.z.object({
  projectId: exports.idSchema,
  clientId: exports.idSchema.optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
  notes: zod_1.z.string().optional(),
});
exports.sendEmailSchema = zod_1.z.object({
  to: zod_1.z.array(exports.emailSchema).min(1),
  subject: zod_1.z.string().min(1).max(200),
  htmlContent: zod_1.z.string(),
  textContent: zod_1.z.string().optional(),
  attachments: zod_1.z
    .array(
      zod_1.z.object({
        filename: zod_1.z.string(),
        content: zod_1.z.string(),
        contentType: zod_1.z.string(),
      }),
    )
    .optional(),
});
exports.createEmailCampaignSchema = zod_1.z.object({
  name: zod_1.z.string().min(1).max(100),
  subject: zod_1.z.string().min(1).max(200),
  fromName: zod_1.z.string().min(1).max(50),
  fromEmail: exports.emailSchema,
  replyTo: exports.emailSchema.optional(),
  htmlContent: zod_1.z.string(),
  textContent: zod_1.z.string().optional(),
  audienceFilter: zod_1.z
    .object({
      tags: zod_1.z.array(zod_1.z.string()).optional(),
      minBookings: zod_1.z.number().min(0).optional(),
      maxBookings: zod_1.z.number().min(0).optional(),
      minSpent: zod_1.z.number().min(0).optional(),
      maxSpent: zod_1.z.number().min(0).optional(),
      hasMarketingConsent: zod_1.z.boolean().optional(),
      lastBookingBefore: zod_1.z.coerce.date().optional(),
      lastBookingAfter: zod_1.z.coerce.date().optional(),
    })
    .optional(),
  testEmails: zod_1.z.array(exports.emailSchema).optional(),
  scheduledFor: zod_1.z.coerce.date().optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.createExpenseSchema = zod_1.z.object({
  category: zod_1.z.nativeEnum(client_1.ExpenseCategory),
  description: zod_1.z.string().min(1),
  amount: zod_1.z.number().positive(),
  currency: exports.currencySchema,
  expenseDate: zod_1.z.coerce.date(),
  vendor: zod_1.z.string().optional(),
  projectReference: zod_1.z.string().optional(),
  isReimbursable: zod_1.z.boolean().default(false),
  notes: zod_1.z.string().optional(),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.updateExpenseSchema = exports.createExpenseSchema.partial();
exports.updateSettingSchema = zod_1.z.object({
  value: zod_1.z.any(),
  description: zod_1.z.string().optional(),
});
exports.searchLocationsSchema = zod_1.z.object({
  query: zod_1.z.string().min(1),
  type: zod_1.z.enum(["country", "state", "city", "timezone"]).optional(),
  countryCode: zod_1.z.string().length(2).optional(),
  stateCode: zod_1.z.string().optional(),
});
exports.reportFiltersSchema = zod_1.z.object({
  startDate: zod_1.z.coerce.date(),
  endDate: zod_1.z.coerce.date(),
  groupBy: zod_1.z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  clientId: exports.idSchema.optional(),
  photographerId: exports.idSchema.optional(),
  projectType: zod_1.z.string().optional(),
  status: zod_1.z.string().optional(),
});
