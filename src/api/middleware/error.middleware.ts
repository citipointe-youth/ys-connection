import type { Response } from 'express';
import { AppError } from '../../core/errors/app-error';
import { ZodError } from 'zod';

export function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: err.errors,
    });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
}
