import type { Actor } from '../../core/entities/user';

export interface HttpRequest {
  ctx: Actor | null;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  /** Request origin (scheme://host), from X-Forwarded-Host when present. */
  origin?: string;
}

/** A non-JSON route result (e.g. an image). The adapter sends the bytes as-is; errors stay JSON. */
export class RawResponse {
  constructor(readonly contentType: string, readonly body: Uint8Array) {}
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: boolean;
  // If true, this route stays reachable for an actor with mustChangePassword set —
  // everything else 403s (MUST_CHANGE_PASSWORD) until the password is changed.
  // Only /auth/me, /auth/logout, and /accounts/me/password should ever need this.
  allowMustChangePassword?: boolean;
  handler: (req: HttpRequest) => Promise<unknown>;
}
