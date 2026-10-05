import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';

describe('bus routes', () => {
  it('registers /bus routes, all authenticated', async () => {
    const { services } = await buildContainer();
    const bus = buildRoutes(services).filter((r) => r.path.startsWith('/bus'));
    expect(bus.length).toBeGreaterThanOrEqual(18);
    expect(bus.every((r) => r.auth)).toBe(true);
  });
  it('is reachable through vercel.json and bypasses the SW cache', () => {
    const root = join(__dirname, '..', '..');
    expect(readFileSync(join(root, 'vercel.json'), 'utf8')).toMatch(/[|(]bus[|)]/);
    expect(readFileSync(join(root, 'public', 'sw.js'), 'utf8')).toMatch(/API_RE = .*[|(]bus[|)]/);
  });
});

describe('R2 routes', () => {
  it('registers autocomplete, generate and undo (authenticated)', async () => {
    const { services } = await buildContainer();
    const routes = buildRoutes(services).filter((r) => r.path.startsWith('/bus'));
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining(['GET /bus/places/autocomplete', 'POST /bus/run/generate', 'POST /bus/run/undo']));
    expect(routes.every((r) => r.auth)).toBe(true);
  });
});

describe('R3 routes', () => {
  it('registers analysis, extra-cars and map', async () => {
    const { services } = await buildContainer();
    const keys = buildRoutes(services).map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining(['GET /bus/analysis', 'POST /bus/analysis/extra-cars', 'GET /bus/analysis/map']));
  });
});
