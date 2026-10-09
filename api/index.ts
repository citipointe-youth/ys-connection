import type { Express } from 'express';

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[CMS] unhandledRejection:', reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[CMS] uncaughtException:', err.message, err.stack);
});

let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    // Dynamic import so an error thrown while LOADING the app (not just building it) is caught here.
    appPromise = import('../src/app').then((m) => m.createAppInstance()).catch((err: unknown) => {
      console.error('[CMS] createAppInstance failed:', err);
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

function startHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/DATABASE_URL/.test(msg)) return 'In Vercel, add DATABASE_URL. Then redeploy.';
  const m = /Missing required env var: (\w+)/.exec(msg);
  if (m) return `In Vercel, add ${m[1]}. Then redeploy.`;
  return 'Open Vercel. Open the newest deployment. Copy the last 20 lines of the logs to the developer.';
}

function handler(req: any, res: any): void {
  getApp().then(
    (app) => { app(req, res); },
    (err: unknown) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The app cannot start.', hint: startHint(err) }));
    },
  );
}

module.exports = handler;
