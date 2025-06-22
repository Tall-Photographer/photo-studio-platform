export declare class AuthService {
  private static instance;
  private constructor();
  static getInstance(): AuthService;
  login(
    email: string,
    password: string,
  ): Promise<{
    success: boolean;
    message: string;
    user: {
      email: string;
    };
  }>;
  register(userData: any): Promise<{
    success: boolean;
    message: string;
    user: any;
  }>;
}
