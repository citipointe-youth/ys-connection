import type { Express } from 'express';
import { buildContainer } from './container';
import { buildRoutes } from './api/http/router';
import { createApp } from './api/http/express-adapter';
import { seedDemoData } from './seed';
import { env } from './config/env';
import { destroySqlClient } from './repositories/supabase/client';

export async function createAppInstance(): Promise<Express> {
  const container = await buildContainer();

  if (env.PERSISTENCE === 'memory') {
    await seedDemoData(container.repos);
  }

  const routes = buildRoutes(container.services);
  // Only Supabase has a pooled connection worth force-closing on a route timeout.
  // Safe to call even though repositories captured getSqlClient()'s return value
  // once at container-build time above — that value is a stable proxy that always
  // re-resolves to whichever real connection is current, so destroying it here
  // doesn't leave those already-built repos holding a dead reference (see
  // destroySqlClient's own comment for why that's exactly what broke last time).
  const onRouteTimeout = env.PERSISTENCE === 'supabase' ? () => { void destroySqlClient(); } : undefined;
  const app = createApp(routes, container.services.auth, onRouteTimeout);

  return app;
}
