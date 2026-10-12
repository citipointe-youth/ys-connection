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
  // The console's /sync routes: no session. The adapter checks `Authorization: Bearer <LINK_SYNC_TOKEN>` instead
  // (exact, timing-safe) and calls the handler with ctx === null. Use with auth: false.
  sync?: true;
  handler: (req: HttpRequest) => Promise<unknown>;
}
