import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log full error details — Prisma errors included
  console.error('=== ERROR HANDLER ===');
  console.error('Name   :', err.name);
  console.error('Message:', err.message);
  if ((err as any).code)  console.error('Code   :', (err as any).code);
  if ((err as any).meta)  console.error('Meta   :', JSON.stringify((err as any).meta, null, 2));
  console.error('Stack  :', err.stack);
  console.error('=====================');

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: (err as any).errors,
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Internal Server Error',
  });
};
