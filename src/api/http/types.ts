import type { Actor } from '../../core/entities/user';

export interface HttpRequest {
  ctx: Actor | null;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: boolean;
  handler: (req: HttpRequest) => Promise<unknown>;
}
