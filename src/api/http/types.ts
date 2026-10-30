import type { Actor } from '../../core/entities/user';

export interface HttpRequest {
  ctx: Actor | null;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  /** Request origin (scheme://host), from X-Forwarded-Host when present. */
  origin?: string;
}

/** What an `auth: true` handler receives: the adapter has already returned 401 when there is no session. */
export type AuthedRequest = HttpRequest & { ctx: Actor };

/** A non-JSON route result (e.g. an image). The adapter sends the bytes as-is; errors stay JSON. */
export class RawResponse {
  constructor(readonly contentType: string, readonly body: Uint8Array) {}
}

interface RouteBase {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  // If true, this route stays reachable for an actor with mustChangePassword set —
  // everything else 403s (MUST_CHANGE_PASSWORD) until the password is changed.
  // Only /auth/me, /auth/logout, and /accounts/me/password should ever need this.
  allowMustChangePassword?: boolean;
  // The console's /sync routes: no session. The adapter checks `Authorization: Bearer <LINK_SYNC_TOKEN>` instead
  // (exact, timing-safe) and calls the handler with ctx === null. Use with auth: false.
  sync?: true;
}

export type Route =
  | (RouteBase & { auth: true; handler: (req: AuthedRequest) => Promise<unknown> })
  | (RouteBase & { auth: false; handler: (req: HttpRequest) => Promise<unknown> });
