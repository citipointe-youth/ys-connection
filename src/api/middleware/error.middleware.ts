import type { Response } from 'express';
import { AppError } from '../../core/errors/app-error';
import { isProductionEnv } from '../../config/is-production';
import { ZodError } from 'zod';
import { RequestTimeoutError } from '../../utils/timeout';
import { isTransientDbError } from '../../utils/transient-db';

/** The status + JSON body for an error (logs the unexpected ones). The adapter reads `status`/`body.code` for the Error log. */
export function errorResponse(err: unknown): { status: number; body: { code: string; message: string } & Record<string, unknown> } {
  if (err instanceof AppError) {
    // `extra` (e.g. existingId, reason, expected) goes after code/message and can never overwrite them.
    return { status: err.statusCode, body: Object.assign({ code: err.code, message: err.message }, err.extra,
      { code: err.code, message: err.message }) };
  }
  if (err instanceof ZodError) {
    return { status: 400, body: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.errors } };
  }
  if (isTransientDbError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Transient DB error (503):', msg);
    return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again.' } };
  }
  if (err instanceof RequestTimeoutError) {
    console.warn('Request timeout (503):', err.message);
    return { status: 503, body: { code: 'REQUEST_TIMEOUT', message: 'This is taking longer than expected. Please try again.' } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', err instanceof Error ? (err.stack ?? msg) : msg);
  const clientMsg = isProductionEnv() ? 'An unexpected error occurred' : msg;
  return { status: 500, body: { code: 'INTERNAL_ERROR', message: clientMsg } };
}

export function sendError(res: Response, err: unknown): void {
  const r = errorResponse(err);
  res.status(r.status).json(r.body);
}
