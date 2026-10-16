// House checklist (CLAUDE.md "adding a new top-level API route"): every route's top-level segment must be in
// a vercel.json function route AND public/sw.js API_RE, or Vercel serves the SPA HTML / the SW caches it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';

const root = join(__dirname, '..', '..');
describe('every route is registered in vercel.json and sw.js', () => {
  it('top-level segments are all routed and network-only', async () => {
    const fn = (JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).routes as { src?: string }[])
      .filter((r) => r.src && r.src !== '/(.*)').map((r) => new RegExp(r.src!)); // every rule but the SPA catch-all
    const vercel = { test: (p: string) => fn.some((re) => re.test(p)) };
    const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
    const apiRe = new RegExp(sw.match(/const API_RE = \/(.*)\/;/)![1]!);
    const { services } = await buildContainer();
    const tops = [...new Set(buildRoutes(services).map((r) => '/' + r.path.split('/')[1]))];
    for (const t of tops) {
      expect(vercel.test(t), `vercel.json ${t}`).toBe(true);
      expect(apiRe.test(t), `sw.js API_RE ${t}`).toBe(true);
    }
  });
  it('the SPA shell gets the same security headers as the API (F6: vercel.json header route before the filesystem handler)', () => {
    const routes = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).routes as
      { src?: string; headers?: Record<string, string>; continue?: boolean; handle?: string; dest?: string }[];
    const hdr = routes.find((r) => r.headers && r.continue);
    expect(hdr?.src).toBe('/(.*)');
    expect(routes.indexOf(hdr!)).toBeLessThan(routes.findIndex((r) => r.handle === 'filesystem'));
    expect(routes.indexOf(hdr!)).toBeGreaterThan(routes.findIndex((r) => r.dest === '/api/index.ts'));
    expect(hdr!.headers).toEqual({
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    expect(hdr!.headers!['Cache-Control']).toBeUndefined(); // sw.js / shell stay cacheable
  });
});
