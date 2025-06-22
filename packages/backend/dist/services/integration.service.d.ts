export declare class IntegrationService {
  private static instance;
  private db;
  private logger;
  private cryptoService;
  private queueService;
  private integrationConfigs;
  private constructor();
  static getInstance(): IntegrationService;
  private loadIntegrationConfigs;
  connectGoogleCalendar(
    userId: string,
    authCode: string,
  ): Promise<{
    connected: boolean;
    calendars: any;
  }>;
  syncBookingToGoogleCalendar(bookingId: string, userId: string): Promise<any>;
  connectQuickBooks(
    studioId: string,
    authCode: string,
  ): Promise<{
    connected: boolean;
    companyName: any;
  }>;
  syncInvoiceToQuickBooks(invoiceId: string): Promise<any>;
  sendZapierWebhook(event: string, data: any): Promise<void>;
  sendSlackNotification(
    studioId: string,
    channel: string,
    message: {
      text: string;
      blocks?: any[];
      attachments?: any[];
    },
  ): Promise<void>;
  uploadToDropbox(
    studioId: string,
    files: Array<{
      path: string;
      content: Buffer;
    }>,
    folderPath: string,
  ): Promise<any[]>;
  private getStudioIdFromUser;
  private getGoogleCalendarIntegration;
  private getGoogleOAuth2Client;
  private getQuickBooksIntegration;
  private getQuickBooksAccessToken;
  private syncCustomerToQuickBooks;
  private getDropboxAccessToken;
  handleStripeWebhook(event: any): Promise<void>;
  private handlePaymentSuccess;
  private handlePaymentFailure;
  private handleSubscriptionUpdate;
}
