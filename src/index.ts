import { buildContainer } from './container';
import { buildRoutes } from './api/http/router';
import { createApp } from './api/http/express-adapter';
import { seedDemoData } from './seed';
import { env } from './config/env';
import { createLogger } from './utils/logger';

const logger = createLogger('server');

async function main() {
  const container = await buildContainer();
  await seedDemoData(container.repos);

  const routes = buildRoutes(container.services);
  const app = createApp(routes, container.services.auth);

  app.listen(env.PORT, () => {
    logger.info(`Youth Allocation Platform running on http://localhost:${env.PORT}`);
    logger.info(`Persistence: ${env.PERSISTENCE}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
