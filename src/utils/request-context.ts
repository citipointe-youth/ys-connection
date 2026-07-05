import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  id: string;
  route: string;
  start: number;
}

// Lets code far from the HTTP layer (the DB client's debug hook) tag its own
// diagnostic logs with the request that triggered it, without threading an id
// through every function signature. Diagnostic-only — read via getStore(),
// never used for behavior.
export const requestContext = new AsyncLocalStorage<RequestContext>();
