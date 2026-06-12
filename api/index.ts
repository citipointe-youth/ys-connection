import { createAppInstance } from '../src/app';

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[CMS] unhandledRejection:', reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[CMS] uncaughtException:', err.message, err.stack);
});

let appPromise: ReturnType<typeof createAppInstance> | null = null;

function getApp(): ReturnType<typeof createAppInstance> {
  if (!appPromise) {
    appPromise = createAppInstance().catch((err: unknown) => {
      console.error('[CMS] createAppInstance failed:', err);
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

function handler(req: any, res: any): void {
  getApp().then(
    (app) => { app(req, res); },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[CMS] handler error:', msg);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg, stack }));
    }
  );
}

module.exports = handler;
