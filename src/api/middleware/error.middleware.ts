import type { Response } from 'express';
import { AppError } from '../../core/errors/app-error';
import { isProductionEnv } from '../../config/is-production';
import { ZodError } from 'zod';
import { RequestTimeoutError } from '../../utils/timeout';
import { isTransientDbError } from '../../utils/transient-db';

export function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    // `extra` (e.g. existingId, reason, expected) goes after code/message and can never overwrite them.
    res.status(err.statusCode).json(Object.assign({ code: err.code, message: err.message }, err.extra,
      { code: err.code, message: err.message }));
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
  if (isTransientDbError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Transient DB error (503):', msg);
    res.status(503).json({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
    });
    return;
  }
  if (err instanceof RequestTimeoutError) {
    console.warn('Request timeout (503):', err.message);
    res.status(503).json({
      code: 'REQUEST_TIMEOUT',
      message: 'This is taking longer than expected. Please try again.',
    });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', err instanceof Error ? (err.stack ?? msg) : msg);
  const clientMsg = isProductionEnv() ? 'An unexpected error occurred' : msg;
  res.status(500).json({ code: 'INTERNAL_ERROR', message: clientMsg });
}
