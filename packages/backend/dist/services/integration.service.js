"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationService = void 0;
const googleapis_1 = require("googleapis");
const google_auth_library_1 = require("google-auth-library");
const axios_1 = __importDefault(require("axios"));
const database_service_1 = require("./database.service");
const logger_service_1 = require("./logger.service");
const crypto_service_1 = require("./crypto.service");
const queue_service_1 = require("./queue.service");
const dayjs_1 = __importDefault(require("dayjs"));
class IntegrationService {
    constructor() {
        this.db = database_service_1.DatabaseService.getInstance().getClient();
        this.logger = logger_service_1.LoggerService.getInstance();
        this.cryptoService = crypto_service_1.CryptoService.getInstance();
        this.queueService = queue_service_1.QueueService.getInstance();
        this.integrationConfigs = new Map();
        this.loadIntegrationConfigs();
    }
    static getInstance() {
        if (!IntegrationService.instance) {
            IntegrationService.instance = new IntegrationService();
        }
        return IntegrationService.instance;
    }
    async loadIntegrationConfigs() {
        this.integrationConfigs.set('google', {
            google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
                clientId: process.env.QUICKBOOKS_CLIENT_ID,
                clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
                environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
            },
        });
    }
    async connectGoogleCalendar(userId, authCode) {
        const config = this.integrationConfigs.get('google')?.google;
        if (!config)
            throw new Error('Google integration not configured');
        const oauth2Client = new google_auth_library_1.OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
        try {
            const { tokens } = await oauth2Client.getToken(authCode);
            oauth2Client.setCredentials(tokens);
            const encryptedTokens = await this.cryptoService.encrypt(JSON.stringify(tokens));
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
            const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
            const calendars = await calendar.calendarList.list();
            return {
                connected: true,
                calendars: calendars.data.items,
            };
        }
        catch (error) {
            this.logger.error('Google Calendar connection failed:', error);
            throw error;
        }
    }
    async syncBookingToGoogleCalendar(bookingId, userId) {
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
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
        const event = {
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
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 60 },
                ],
            },
        };
        try {
            const response = await calendar.events.insert({
                calendarId: 'primary',
                requestBody: event,
                sendUpdates: 'all',
            });
            await this.db.booking.update({
                where: { id: bookingId },
                data: {
                    customFields: {
                        ...(booking.customFields || {}),
                        googleCalendarEventId: response.data.id,
                    },
                },
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to sync booking to Google Calendar:', error);
            throw error;
        }
    }
    async connectQuickBooks(studioId, authCode) {
        const config = this.integrationConfigs.get('quickbooks')?.quickbooks;
        if (!config)
            throw new Error('QuickBooks integration not configured');
        try {
            const tokenResponse = await axios_1.default.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', new URLSearchParams({
                grant_type: 'authorization_code',
                code: authCode,
                redirect_uri: `${process.env.APP_URL}/api/v1/integrations/quickbooks/callback`,
            }), {
                auth: {
                    username: config.clientId,
                    password: config.clientSecret,
                },
            });
            const { access_token, refresh_token, x_refresh_token_expires_in, expires_in } = tokenResponse.data;
            const encryptedTokens = await this.cryptoService.encrypt(JSON.stringify({
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: (0, dayjs_1.default)().add(expires_in, 'seconds').toISOString(),
                refreshExpiresAt: (0, dayjs_1.default)().add(x_refresh_token_expires_in, 'seconds').toISOString(),
            }));
            const companyResponse = await axios_1.default.get(`https://${config.environment}.api.intuit.com/v3/company/${authCode}/companyinfo/1`, {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    Accept: 'application/json',
                },
            });
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
        }
        catch (error) {
            this.logger.error('QuickBooks connection failed:', error);
            throw error;
        }
    }
    async syncInvoiceToQuickBooks(invoiceId) {
        const invoice = await this.db.invoice.findUnique({
            where: { id: invoiceId },
            include: {
                client: true,
                lineItems: true,
                studio: true,
            },
        });
        if (!invoice)
            throw new Error('Invoice not found');
        const integration = await this.getQuickBooksIntegration(invoice.studioId);
        if (!integration)
            throw new Error('QuickBooks not connected');
        const accessToken = await this.getQuickBooksAccessToken(invoice.studioId);
        const customerId = await this.syncCustomerToQuickBooks(invoice.client, invoice.studioId, accessToken);
        const qbInvoice = {
            Line: invoice.lineItems.map((item, index) => ({
                Id: String(index + 1),
                Amount: item.total,
                DetailType: 'SalesItemLineDetail',
                SalesItemLineDetail: {
                    ItemRef: {
                        value: '1',
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
            const response = await axios_1.default.post(`https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/invoice`, qbInvoice, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            });
            await this.db.invoice.update({
                where: { id: invoiceId },
                data: {
                    customFields: {
                        ...(invoice.customFields || {}),
                        quickbooksInvoiceId: response.data.Invoice.Id,
                    },
                },
            });
            return response.data.Invoice;
        }
        catch (error) {
            this.logger.error('Failed to sync invoice to QuickBooks:', error);
            throw error;
        }
    }
    async sendZapierWebhook(event, data) {
        const zapierConfig = await this.db.systemSetting.findFirst({
            where: {
                key: 'zapier_integration',
                category: 'integrations',
            },
        });
        if (!zapierConfig || !zapierConfig.value.enabled) {
            return;
        }
        const webhookUrl = zapierConfig.value.webhookUrl;
        try {
            await axios_1.default.post(webhookUrl, {
                event,
                timestamp: new Date().toISOString(),
                data,
            }, {
                headers: {
                    'X-API-Key': zapierConfig.value.apiKey,
                },
            });
        }
        catch (error) {
            this.logger.error('Zapier webhook failed:', error);
        }
    }
    async sendSlackNotification(studioId, channel, message) {
        const slackConfig = await this.db.systemSetting.findFirst({
            where: {
                studioId,
                key: 'slack_integration',
                category: 'integrations',
            },
        });
        if (!slackConfig || !slackConfig.value.connected) {
            return;
        }
        const webhookUrl = slackConfig.value.webhookUrl;
        try {
            await axios_1.default.post(webhookUrl, {
                channel,
                ...message,
            });
        }
        catch (error) {
            this.logger.error('Slack notification failed:', error);
        }
    }
    async uploadToDropbox(studioId, files, folderPath) {
        const dropboxConfig = await this.db.systemSetting.findFirst({
            where: {
                studioId,
                key: 'dropbox_integration',
                category: 'integrations',
            },
        });
        if (!dropboxConfig || !dropboxConfig.value.connected) {
            throw new Error('Dropbox not connected');
        }
        const accessToken = await this.getDropboxAccessToken(studioId);
        const uploadPromises = files.map(async (file) => {
            const response = await axios_1.default.post('https://content.dropboxapi.com/2/files/upload', file.content, {
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
            });
            return response.data;
        });
        return Promise.all(uploadPromises);
    }
    async getStudioIdFromUser(userId) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: { studioId: true },
        });
        if (!user)
            throw new Error('User not found');
        return user.studioId;
    }
    async getGoogleCalendarIntegration(userId) {
        const studioId = await this.getStudioIdFromUser(userId);
        return this.db.systemSetting.findFirst({
            where: {
                studioId,
                key: `google_calendar_${userId}`,
                category: 'integrations',
            },
        });
    }
    async getGoogleOAuth2Client(userId) {
        const config = this.integrationConfigs.get('google')?.google;
        if (!config)
            throw new Error('Google integration not configured');
        const integration = await this.getGoogleCalendarIntegration(userId);
        if (!integration)
            throw new Error('Google Calendar not connected');
        const encryptedTokens = integration.value.tokens;
        const tokensJson = await this.cryptoService.decrypt(encryptedTokens);
        const tokens = JSON.parse(tokensJson);
        const oauth2Client = new google_auth_library_1.OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
        oauth2Client.setCredentials(tokens);
        if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials);
            const newEncryptedTokens = await this.cryptoService.encrypt(JSON.stringify(credentials));
            await this.db.systemSetting.update({
                where: { id: integration.id },
                data: {
                    value: {
                        ...integration.value,
                        tokens: newEncryptedTokens,
                    },
                },
            });
        }
        return oauth2Client;
    }
    async getQuickBooksIntegration(studioId) {
        const integration = await this.db.systemSetting.findFirst({
            where: {
                studioId,
                key: 'quickbooks_integration',
                category: 'integrations',
            },
        });
        if (!integration)
            return null;
        return integration.value;
    }
    async getQuickBooksAccessToken(studioId) {
        const integration = await this.getQuickBooksIntegration(studioId);
        if (!integration)
            throw new Error('QuickBooks not connected');
        const tokensJson = await this.cryptoService.decrypt(integration.tokens);
        const tokens = JSON.parse(tokensJson);
        if ((0, dayjs_1.default)(tokens.expiresAt).isBefore((0, dayjs_1.default)())) {
            const config = this.integrationConfigs.get('quickbooks')?.quickbooks;
            if (!config)
                throw new Error('QuickBooks configuration not found');
            const response = await axios_1.default.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: tokens.refreshToken,
            }), {
                auth: {
                    username: config.clientId,
                    password: config.clientSecret,
                },
            });
            const newTokens = {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresAt: (0, dayjs_1.default)().add(response.data.expires_in, 'seconds').toISOString(),
                refreshExpiresAt: (0, dayjs_1.default)().add(response.data.x_refresh_token_expires_in, 'seconds').toISOString(),
            };
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
    async syncCustomerToQuickBooks(client, studioId, accessToken) {
        const integration = await this.getQuickBooksIntegration(studioId);
        if (!integration)
            throw new Error('QuickBooks not connected');
        const searchResponse = await axios_1.default.get(`https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/query?query=select * from Customer where PrimaryEmailAddr='${client.email}'`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
            },
        });
        if (searchResponse.data.QueryResponse.Customer?.length > 0) {
            return searchResponse.data.QueryResponse.Customer[0].Id;
        }
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
        const createResponse = await axios_1.default.post(`https://${integration.environment}.api.intuit.com/v3/company/${integration.companyId}/customer`, customer, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });
        return createResponse.data.Customer.Id;
    }
    async getDropboxAccessToken(studioId) {
        const integration = await this.db.systemSetting.findFirst({
            where: {
                studioId,
                key: 'dropbox_integration',
                category: 'integrations',
            },
        });
        if (!integration)
            throw new Error('Dropbox not connected');
        const tokens = integration.value.tokens;
        return tokens.accessToken;
    }
    async handleStripeWebhook(event) {
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
    async handlePaymentSuccess(paymentIntent) {
        await this.db.payment.updateMany({
            where: {
                gatewayTransactionId: paymentIntent.id,
            },
            data: {
                status: 'COMPLETED',
                processedAt: new Date(),
            },
        });
        await this.sendZapierWebhook('payment.completed', {
            paymentId: paymentIntent.id,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
        });
    }
    async handlePaymentFailure(paymentIntent) {
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
    async handleSubscriptionUpdate(subscription) {
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
exports.IntegrationService = IntegrationService;
