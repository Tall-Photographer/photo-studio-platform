import { Request, Response, NextFunction } from "express";
interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}
export declare const errorHandler: (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction,
) => void;
export declare const notFoundHandler: (req: Request, res: Response) => void;
export declare const asyncHandler: (
  fn: Function,
) => (req: Request, res: Response, next: NextFunction) => void;
export {};
