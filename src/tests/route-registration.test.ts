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
});
