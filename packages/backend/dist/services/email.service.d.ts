interface BookingEmailDetails {
  title: string;
  startDate: string;
  endDate: string;
  duration: number;
  location?: string;
  totalAmount: number;
  currency: string;
  studioName: string;
}
export declare class EmailService {
  private transporter;
  private logger;
  private fromEmail;
  private fromName;
  constructor();
  private setupTransporter;
  private setupSendGrid;
  private setupSMTP;
  private setupTestTransporter;
  private sendEmail;
  private stripHtml;
  sendVerificationEmail(
    email: string,
    firstName: string,
    token: string,
  ): Promise<void>;
  sendPasswordResetEmail(
    email: string,
    firstName: string,
    token: string,
  ): Promise<void>;
  sendBookingConfirmation(
    email: string,
    clientName: string,
    bookingDetails: BookingEmailDetails,
  ): Promise<void>;
  testConnection(): Promise<boolean>;
}
export {};
