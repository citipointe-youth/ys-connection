import type { Express } from 'express';
import { buildContainer } from './container';
import { buildRoutes } from './api/http/router';
import { createApp } from './api/http/express-adapter';
import { seedDemoData } from './seed';
import { env } from './config/env';

export async function createAppInstance(): Promise<Express> {
  const container = await buildContainer();

  // Never seed the public demo logins on a production deployment that forgot PERSISTENCE:
  // it would expose admin/demo1234. With no users, the setup screen takes over instead.
  if (env.PERSISTENCE === 'memory' && process.env['VERCEL_ENV'] !== 'production') {
    await seedDemoData(container.repos);
  }

  const routes = buildRoutes(container.services);
  // A stuck EXECUTING query is bounded by the role-level statement_timeout=15s
  // (ALTER ROLE postgres SET statement_timeout, applied on the prod DB); the route
  // timeout in express-adapter is the outer safety net. No destroy-on-timeout hook —
  // an incident-era escalation that caused cross-request CONNECTION_DESTROYED
  // failures; see the incident resolution notes in CLAUDE.md.
  const app = createApp(routes, container.services.auth, container.services.health);

  return app;
}
