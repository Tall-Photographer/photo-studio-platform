// packages/backend/src/services/integration.service.ts
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { CryptoService } from './crypto.service';
import { QueueService } from './queue.service';
import dayjs from 'dayjs';

interface IntegrationConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  };
  quickbooks?: {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'production';
  };
  zapier?: {
    apiKey: string;
    webhookUrl: string;
  };
  slack?: {
    clientId: string;
    clientSecret: string;
    signingSecret: string;
  };
  dropbox?: {
    appKey: string;
    appSecret: string;
  };
  mailchimp?: {
    apiKey: string;
    server: string;
  };
}

interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
}

export class IntegrationService {
  private static instance: IntegrationService;
  private db = DatabaseService.getInstance().getClient();
  private logger = LoggerService.getInstance();
  private cryptoService = CryptoService.getInstance();
  private queueService = QueueService.getInstance();
  private integrationConfigs: Map<string, IntegrationConfig> = new Map();

  private constructor() {
    this.loadIntegrationConfigs();
  }

  public static getInstance(): IntegrationService {
    if (!IntegrationService.instance) {
      IntegrationService.instance = new IntegrationService();
    }
    return IntegrationService.instance;
  }

  private async loadIntegrationConfigs() {
    // Load integration configurations from environment or database
    this.integrationConfigs.set('google', {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: `${process.env.APP_URL}/api/v1/integrations/google/callback`,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/contacts.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
    });

    this.integrationConfigs.set('quickbooks', {
      quickbooks: {
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: (process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      },
    });
  }

  // Google Calendar Integration
  public async connectGoogleCalendar(userId: string, authCode: string) {
    const config = this.integrationConfigs.get('google')?.google;
    if (!config) throw new Error('Google integration not configured');

    const oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    try {
      const { tokens } = await oauth2Client.getToken(authCode);
      oauth2Client.setCredentials(tokens);

      // Encrypt tokens before storing
      const encryptedTokens = await this.cryptoService.encrypt(JSON.stringify(tokens));

      // Store integration
      await this.db.systemSetting.upsert({
        where: {
          studioId_key: {
            studioId: await this.getStudioIdFromUser(userId),
            key: `google_calendar_${userId}`,
          },
        },
        create: {
          studioId: await this.getStudioIdFromUser(userId),
          key: `google_calendar_${userId}`,
          category: 'integrations',
          value: {
            tokens: encryptedTokens,
            connected: true,
            connectedAt: new Date(),
            scopes: config.scopes,
          },
          description: 'Google Calendar integration',
        },
        update: {
          value: {
            tokens: encryptedTokens,
            connected: true,
            connectedAt: new Date(),
            scopes: config.scopes,
          },
        },
      });

      // Test connection by fetching calendars
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const calendars = await calendar.calendarList.list();

      return {
        connected: true,
        calendars: calendars.data.items,
      };
    } catch (error) {
      this.logger.error('Google Calendar connection failed:', error);
      throw error;
    }
  }

  public async syncBookingToGoogleCalendar(bookingId: string, userId: string) {
    const [booking, integration] = await Promise.all([
      this.db.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          assignments: {
            include: {
              user: true,
            },
          },
          roomAssignments: {
            include: {
              room: true,
            },
          },
        },
      }),
      this.getGoogleCalendarIntegration(userId),
    ]);

    if (!booking || !integration) {
      throw new Error('Booking or integration not found');
    }

    const oauth2Client = await this.getGoogleOAuth2Client(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Create event
    const event: GoogleCalendarEvent = {
      summary: booking.title,
      description: `${booking.description || ''}\n\nClient: ${booking.client.firstName} ${booking.client.lastName}\nBooking #: ${booking.bookingNumber}`,
      location: booking.locationType === 'STUDIO' 
        ? booking.roomAssignments[0]?.room.name 
        : booking.locationAddress || booking.location,
      start: {
        dateTime: booking.startDateTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: booking.endDateTime.toISOString(),
        timeZone: 'UTC',
      },
      attendees: [
        {
          email: booking.client.email,
          displayName: `${booking.client.firstName} ${booking.client.lastName}`,
        },
        ...booking.assignments.map(a => ({
          email: a.user.email,
          displayName: `${a.user.firstName} ${a.user.lastName}`,
        })),
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email' as const, minutes: 24 * 60 }, // 1 day before
          { method: 'popup' as const, minutes: 60 }, // 1 hour before
        ],
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        sendUpdates: 'all',
      });

      // Store event ID in booking metadata
      await this.db.booking.update({
        where: { id: bookingId },
        data: {
          customFields: {
            ...(booking.customFields as any || {}),
            googleCalendarEventId: response.data.id,
          },
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to sync booking to Google Calendar:', error);
      throw error;
    }
  }

  // QuickBooks Integration
  public async connectQuickBooks(studioId: string, authCode: string) {
    const config = this.integrationConfigs.get('quickbooks')?.quickbooks;
    if (!config) throw new Error('QuickBooks integration not configured');

    try {
      // Exchange auth code for tokens
      const tokenResponse = await axios.post(
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: `${process.env.APP_URL}/api/v1/integrations/quickbooks/callback`,
        }),
        {
          auth: {
            username: config.clientId,
            password: config.clientSecret,
          },
        }
      );

      const { access_token, refresh_token, x_refresh_token_expires_in, expires_in } = tokenResponse.data;

      // Encrypt tokens
      const encryptedTokens = await this.cryptoService.encrypt(JSON.stringify({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: dayjs().add(expires_in, 'seconds').toISOString(),
        refreshExpiresAt: dayjs().add(x_refresh_token_expires_in, 'seconds').toISOString(),
      }));

      // Get company info
      const companyResponse = await axios.get(
        `https://${config.environment}.api.intuit.com/v3/company/${authCode}/companyinfo/1`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            Accept: 'application/json',
          },
        }
      );

      // Store integration
      await this.db.systemSetting.upsert({
        where: {
          studioId_key: {
            studioId,
            key: 'quickbooks_integration',
          },
        },
        create: {
          studioId,
          key: 'quickbooks_integration',
          category: 'integrations',
          value: {
            tokens: encryptedTokens,
            companyId: authCode,
            companyName: companyResponse.data.CompanyInfo.CompanyName,
            environment: config.environment,
            connected: true,
            connectedAt: new Date(),
          },
          description: 'QuickBooks integration',
        },
        update: {
          value: {
            tokens: encryptedTokens,
            companyId: authCode,
            companyName: companyResponse.data.CompanyInfo.CompanyName,
            environment: config.environment,
            connected: true,
            connectedAt: new Date(),
          },
        },
      });

      return {
        connected: true,
        companyName: companyResponse.data.CompanyInfo.CompanyName,
      };
    } catch (error) {
      this.logger.error('QuickBooks connection failed:', error);
      throw error;
    }
  }

  public async syncInvoiceToQuickBooks(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        lineItems: true,
        studio: true,
      },
    });

    if (!invoice) throw new Error('Invoice not found');

    const integration = await this.getQuickBooksIntegration(invoice.studioId);
    if (!integration) throw new Error('QuickBooks not connected');

    const accessToken = await this.getQuickBooksAccessToken(invoice.studioId);

    // Create or update customer
    const customerId = await this.syncCustomerToQuickBooks(invoice.client, invoice.studioId, accessToken);

    // Create invoice in QuickBooks
    const qbInvoice = {
      Line: invoice.lineItems.map((item, index) => ({
        Id: String(index + 1),
        Amount: item.total,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: {
            value: '1', // Default service item
            name: 'Services',
          },
        },
        Description: item.description,
      })),
      CustomerRef: {
        value: customerId,
      },
      DueDate: invoice.dueDate.toISOString().split('T')[0],
      TxnDate: invoice.issueDate.toISOString().split('T')[0],
      DocNumber: invoice.invoiceNumber,
      PrivateNote: invoice.notes,
      TotalAmt: invoice.total,
    };

    try {
      const response = await axios.post(
        `https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/invoice`,
        qbInvoice,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      // Store QuickBooks invoice ID
      await this.db.invoice.update({
        where: { id: invoiceId },
        data: {
          customFields: {
            ...(invoice.customFields as any || {}),
            quickbooksInvoiceId: response.data.Invoice.Id,
          },
        },
      });

      return response.data.Invoice;
    } catch (error) {
      this.logger.error('Failed to sync invoice to QuickBooks:', error);
      throw error;
    }
  }

  // Zapier Integration
  public async sendZapierWebhook(event: string, data: any) {
    const zapierConfig = await this.db.systemSetting.findFirst({
      where: {
        key: 'zapier_integration',
        category: 'integrations',
      },
    });

    if (!zapierConfig || !(zapierConfig.value as any).enabled) {
      return;
    }

    const webhookUrl = (zapierConfig.value as any).webhookUrl;

    try {
      await axios.post(webhookUrl, {
        event,
        timestamp: new Date().toISOString(),
        data,
      }, {
        headers: {
          'X-API-Key': (zapierConfig.value as any).apiKey,
        },
      });
    } catch (error) {
      this.logger.error('Zapier webhook failed:', error);
    }
  }

  // Slack Integration
  public async sendSlackNotification(
    studioId: string,
    channel: string,
    message: {
      text: string;
      blocks?: any[];
      attachments?: any[];
    }
  ) {
    const slackConfig = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: 'slack_integration',
        category: 'integrations',
      },
    });

    if (!slackConfig || !(slackConfig.value as any).connected) {
      return;
    }

    const webhookUrl = (slackConfig.value as any).webhookUrl;

    try {
      await axios.post(webhookUrl, {
        channel,
        ...message,
      });
    } catch (error) {
      this.logger.error('Slack notification failed:', error);
    }
  }

  // Dropbox Integration
  public async uploadToDropbox(
    studioId: string,
    files: Array<{ path: string; content: Buffer }>,
    folderPath: string
  ) {
    const dropboxConfig = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: 'dropbox_integration',
        category: 'integrations',
      },
    });

    if (!dropboxConfig || !(dropboxConfig.value as any).connected) {
      throw new Error('Dropbox not connected');
    }

    const accessToken = await this.getDropboxAccessToken(studioId);

    const uploadPromises = files.map(async (file) => {
      const response = await axios.post(
        'https://content.dropboxapi.com/2/files/upload',
        file.content,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({
              path: `${folderPath}/${file.path}`,
              mode: 'add',
              autorename: true,
              mute: false,
            }),
            'Content-Type': 'application/octet-stream',
          },
        }
      );

      return response.data;
    });

    return Promise.all(uploadPromises);
  }

  // Helper methods
  private async getStudioIdFromUser(userId: string): Promise<string> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { studioId: true },
    });

    if (!user) throw new Error('User not found');
    return user.studioId;
  }

  private async getGoogleCalendarIntegration(userId: string) {
    const studioId = await this.getStudioIdFromUser(userId);
    
    return this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: `google_calendar_${userId}`,
        category: 'integrations',
      },
    });
  }

  private async getGoogleOAuth2Client(userId: string): Promise<OAuth2Client> {
    const config = this.integrationConfigs.get('google')?.google;
    if (!config) throw new Error('Google integration not configured');

    const integration = await this.getGoogleCalendarIntegration(userId);
    if (!integration) throw new Error('Google Calendar not connected');

    const encryptedTokens = (integration.value as any).tokens;
    const tokensJson = await this.cryptoService.decrypt(encryptedTokens);
    const tokens = JSON.parse(tokensJson);

    const oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    oauth2Client.setCredentials(tokens);

    // Refresh token if needed
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Update stored tokens
      const newEncryptedTokens = await this.cryptoService.encrypt(JSON.stringify(credentials));
      await this.db.systemSetting.update({
        where: { id: integration.id },
        data: {
          value: {
            ...(integration.value as any),
            tokens: newEncryptedTokens,
          },
        },
      });
    }

    return oauth2Client;
  }

  private async getQuickBooksIntegration(studioId: string) {
    const integration = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: 'quickbooks_integration',
        category: 'integrations',
      },
    });

    if (!integration) return null;

    return integration.value as any;
  }

  private async getQuickBooksAccessToken(studioId: string): Promise<string> {
    const integration = await this.getQuickBooksIntegration(studioId);
    if (!integration) throw new Error('QuickBooks not connected');

    const tokensJson = await this.cryptoService.decrypt(integration.tokens);
    const tokens = JSON.parse(tokensJson);

    // Check if token is expired
    if (dayjs(tokens.expiresAt).isBefore(dayjs())) {
      // Refresh token
      const config = this.integrationConfigs.get('quickbooks')?.quickbooks;
      if (!config) throw new Error('QuickBooks configuration not found');

      const response = await axios.post(
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }),
        {
          auth: {
            username: config.clientId,
            password: config.clientSecret,
          },
        }
      );

      const newTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: dayjs().add(response.data.expires_in, 'seconds').toISOString(),
        refreshExpiresAt: dayjs().add(response.data.x_refresh_token_expires_in, 'seconds').toISOString(),
      };

      // Update stored tokens
      const encryptedTokens = await this.cryptoService.encrypt(JSON.stringify(newTokens));
      await this.db.systemSetting.update({
        where: {
          studioId,
          key: 'quickbooks_integration',
        },
        data: {
          value: {
            ...integration,
            tokens: encryptedTokens,
          },
        },
      });

      return newTokens.accessToken;
    }

    return tokens.accessToken;
  }

  private async syncCustomerToQuickBooks(
    client: any,
    studioId: string,
    accessToken: string
  ): Promise<string> {
    const integration = await this.getQuickBooksIntegration(studioId);
    if (!integration) throw new Error('QuickBooks not connected');

    // Check if customer already exists
    const searchResponse = await axios.get(
      `https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/query?query=select * from Customer where PrimaryEmailAddr='${client.email}'`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (searchResponse.data.QueryResponse.Customer?.length > 0) {
      return searchResponse.data.QueryResponse.Customer[0].Id;
    }

    // Create new customer
    const customer = {
      DisplayName: `${client.firstName} ${client.lastName}`,
      GivenName: client.firstName,
      FamilyName: client.lastName,
      PrimaryEmailAddr: {
        Address: client.email,
      },
      PrimaryPhone: client.phone ? {
        FreeFormNumber: client.phone,
      } : undefined,
      CompanyName: client.company,
      BillAddr: client.address ? {
        Line1: client.address,
        City: client.city,
        CountrySubDivisionCode: client.state,
        PostalCode: client.postalCode,
      } : undefined,
    };

    const createResponse = await axios.post(
      `https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/customer`,
      customer,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    return createResponse.data.Customer.Id;
  }

  private async getDropboxAccessToken(studioId: string): Promise<string> {
    const integration = await this.db.systemSetting.findFirst({
      where: {
        studioId,
        key: 'dropbox_integration',
        category: 'integrations',
      },
    });

    if (!integration) throw new Error('Dropbox not connected');

    const tokens = (integration.value as any).tokens;
    return tokens.accessToken;
  }

  // Webhook handlers for various integrations
  public async handleStripeWebhook(event: any) {
    // Process Stripe webhooks for payment updates
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailure(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object);
        break;
    }
  }

  private async handlePaymentSuccess(paymentIntent: any) {
    // Update payment record
    await this.db.payment.updateMany({
      where: {
        gatewayTransactionId: paymentIntent.id,
      },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    // Send webhook to Zapier
    await this.sendZapierWebhook('payment.completed', {
      paymentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
    });
  }

  private async handlePaymentFailure(paymentIntent: any) {
    // Update payment record
    await this.db.payment.updateMany({
      where: {
        gatewayTransactionId: paymentIntent.id,
      },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
      },
    });
  }

  private async handleSubscriptionUpdate(subscription: any) {
    // Update studio subscription
    await this.db.studio.updateMany({
      where: {
        subscriptionId: subscription.id,
      },
      data: {
        subscriptionStatus: subscription.status,
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
      },
    });
  }
}