// packages/backend/src/api/bookings/booking.routes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { BookingService } from '../../services/booking.service';
import { WeatherService } from '../../services/weather.service';
import { validate } from '../../middleware/validate';
import { authenticate, requireRole, requireOwnership } from '../../middleware/auth';
import {
  createBookingSchema,
  updateBookingSchema,
  paginationSchema,
  dateRangeSchema,
  idSchema,
} from '../../utils/validation';
import { z } from 'zod';

const router = Router();
const bookingService = BookingService.getInstance();
const weatherService = WeatherService.getInstance();

// Get all bookings (with filters)
router.get(
  '/',
  authenticate,
  validate(
    paginationSchema.extend({
      status: z.string().optional(),
      clientId: idSchema.optional(),
      photographerId: idSchema.optional(),
      locationType: z.string().optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      search: z.string().optional(),
    }),
    'query'
  ),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const result = await bookingService.getBookings({
        studioId: req.user.studioId,
        userId: req.user.id,
        userRole: req.user.role,
        filters: req.query,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get booking by ID
router.get(
  '/:id',
  authenticate,
  requireOwnership('booking'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.getBookingById(req.params.id, req.user);

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Create booking
router.post(
  '/',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER', 'PHOTOGRAPHER', 'VIDEOGRAPHER'),
  validate(createBookingSchema),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.createBooking({
        ...req.body,
        studioId: req.user.studioId,
        createdById: req.user.id,
      });

      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Update booking
router.put(
  '/:id',
  authenticate,
  requireOwnership('booking'),
  validate(updateBookingSchema),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.updateBooking(
        req.params.id,
        req.body,
        req.user
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel booking
router.post(
  '/:id/cancel',
  authenticate,
  requireOwnership('booking'),
  validate(z.object({ reason: z.string().optional() })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.cancelBooking(
        req.params.id,
        req.body.reason,
        req.user
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Confirm booking
router.post(
  '/:id/confirm',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.confirmBooking(req.params.id, req.user);

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Check availability
router.post(
  '/check-availability',
  authenticate,
  validate(z.object({
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    equipmentIds: z.array(idSchema).optional(),
    roomIds: z.array(idSchema).optional(),
    photographerIds: z.array(idSchema).optional(),
    excludeBookingId: idSchema.optional(),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const availability = await bookingService.checkAvailability({
        ...req.body,
        studioId: req.user.studioId,
      });

      res.json(availability);
    } catch (error) {
      next(error);
    }
  }
);

// Get weather for outdoor shoots
router.get(
  '/:id/weather',
  authenticate,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.getBookingById(req.params.id, req.user);

      if (booking.locationType !== 'OUTDOOR') {
        return res.status(400).json({ error: 'Weather is only available for outdoor shoots' });
      }

      if (!booking.locationLatitude || !booking.locationLongitude) {
        return res.status(400).json({ error: 'Location coordinates required for weather data' });
      }

      const weather = await weatherService.getWeatherForecast(
        booking.locationLatitude,
        booking.locationLongitude,
        booking.startDateTime
      );

      res.json(weather);
    } catch (error) {
      next(error);
    }
  }
);

// Update weather alert
router.post(
  '/:id/weather-alert',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER', 'PHOTOGRAPHER'),
  validate(z.object({
    alert: z.string(),
    suggestReschedule: z.boolean().optional(),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.updateWeatherAlert(
        req.params.id,
        req.body.alert,
        req.user
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Get booking assignments
router.get(
  '/:id/assignments',
  authenticate,
  requireOwnership('booking'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const assignments = await bookingService.getBookingAssignments(req.params.id);

      res.json(assignments);
    } catch (error) {
      next(error);
    }
  }
);

// Update booking assignments
router.put(
  '/:id/assignments',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER'),
  validate(z.object({
    assignments: z.array(z.object({
      userId: idSchema,
      role: z.string(),
      isPrimary: z.boolean().default(false),
      rate: z.number().positive().optional(),
    })),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const assignments = await bookingService.updateBookingAssignments(
        req.params.id,
        req.body.assignments,
        req.user
      );

      res.json(assignments);
    } catch (error) {
      next(error);
    }
  }
);

// Accept/decline assignment
router.post(
  '/:id/assignments/:assignmentId/:action',
  authenticate,
  validate(z.object({
    reason: z.string().optional(),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { id, assignmentId, action } = req.params;

      if (!['accept', 'decline'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }

      const assignment = await bookingService.respondToAssignment(
        assignmentId,
        action as 'accept' | 'decline',
        req.user,
        req.body.reason
      );

      res.json(assignment);
    } catch (error) {
      next(error);
    }
  }
);

// Get equipment assignments
router.get(
  '/:id/equipment',
  authenticate,
  requireOwnership('booking'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const equipment = await bookingService.getBookingEquipment(req.params.id);

      res.json(equipment);
    } catch (error) {
      next(error);
    }
  }
);

// Update equipment assignments
router.put(
  '/:id/equipment',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER', 'PHOTOGRAPHER'),
  validate(z.object({
    equipmentIds: z.array(idSchema),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const equipment = await bookingService.updateBookingEquipment(
        req.params.id,
        req.body.equipmentIds,
        req.user
      );

      res.json(equipment);
    } catch (error) {
      next(error);
    }
  }
);

// Get room assignments
router.get(
  '/:id/rooms',
  authenticate,
  requireOwnership('booking'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const rooms = await bookingService.getBookingRooms(req.params.id);

      res.json(rooms);
    } catch (error) {
      next(error);
    }
  }
);

// Update room assignments
router.put(
  '/:id/rooms',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER'),
  validate(z.object({
    rooms: z.array(z.object({
      roomId: idSchema,
      startDateTime: z.coerce.date(),
      endDateTime: z.coerce.date(),
      setupTime: z.number().min(0).default(0),
      breakdownTime: z.number().min(0).default(0),
    })),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const rooms = await bookingService.updateBookingRooms(
        req.params.id,
        req.body.rooms,
        req.user
      );

      res.json(rooms);
    } catch (error) {
      next(error);
    }
  }
);

// Generate contract
router.post(
  '/:id/contract',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const contract = await bookingService.generateContract(req.params.id, req.user);

      res.json(contract);
    } catch (error) {
      next(error);
    }
  }
);

// Sign contract
router.post(
  '/:id/contract/sign',
  authenticate,
  validate(z.object({
    signature: z.string(),
    signedAt: z.coerce.date().optional(),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.signContract(
        req.params.id,
        req.body.signature,
        req.user,
        req.body.signedAt
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Get calendar view
router.get(
  '/calendar/view',
  authenticate,
  validate(
    z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      view: z.enum(['month', 'week', 'day']).optional(),
      photographerId: idSchema.optional(),
      roomId: idSchema.optional(),
      includeEquipment: z.coerce.boolean().optional(),
    }),
    'query'
  ),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const calendar = await bookingService.getCalendarView({
        ...req.query,
        studioId: req.user.studioId,
        userId: req.user.id,
        userRole: req.user.role,
      });

      res.json(calendar);
    } catch (error) {
      next(error);
    }
  }
);

// Get upcoming bookings
router.get(
  '/upcoming',
  authenticate,
  validate(
    z.object({
      days: z.coerce.number().min(1).max(90).default(7),
      includeWeather: z.coerce.boolean().optional(),
    }),
    'query'
  ),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const bookings = await bookingService.getUpcomingBookings({
        studioId: req.user.studioId,
        userId: req.user.id,
        userRole: req.user.role,
        days: req.query.days,
        includeWeather: req.query.includeWeather,
      });

      res.json(bookings);
    } catch (error) {
      next(error);
    }
  }
);

// Get location suggestions
router.get(
  '/locations/suggest',
  authenticate,
  validate(
    z.object({
      query: z.string().min(3),
      type: z.enum(['outdoor', 'venue', 'all']).optional(),
    }),
    'query'
  ),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const suggestions = await bookingService.getLocationSuggestions(
        req.query.query,
        req.user.studioId,
        req.query.type
      );

      res.json(suggestions);
    } catch (error) {
      next(error);
    }
  }
);

// Reschedule booking
router.post(
  '/:id/reschedule',
  authenticate,
  requireOwnership('booking'),
  validate(z.object({
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    reason: z.string().optional(),
    notifyClient: z.boolean().default(true),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.rescheduleBooking(
        req.params.id,
        {
          startDateTime: req.body.startDateTime,
          endDateTime: req.body.endDateTime,
          reason: req.body.reason,
        },
        req.user,
        req.body.notifyClient
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

// Clone booking
router.post(
  '/:id/clone',
  authenticate,
  requireRole('STUDIO_ADMIN', 'MANAGER'),
  validate(z.object({
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    clientId: idSchema.optional(),
  })),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const booking = await bookingService.cloneBooking(
        req.params.id,
        {
          startDateTime: req.body.startDateTime,
          endDateTime: req.body.endDateTime,
          clientId: req.body.clientId,
        },
        req.user
      );

      res.json(booking);
    } catch (error) {
      next(error);
    }
  }
);

export default router;