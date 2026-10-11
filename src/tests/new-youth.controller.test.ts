import { describe, it, expect, vi } from 'vitest';
import { makeNewYouthController } from '../api/controllers/new-youth.controller';
import { UnauthorizedError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';

const ACTOR: Actor = { id: 'a', role: 'grade' as any, displayName: 'G', grade: null as any, quad: null as any };

describe('new-youth controller', () => {
  it('passes actor + raw body to the service', async () => {
    const send = vi.fn(async () => ({ student: 'sent', parent: 'sent', dryRun: false }));
    const c = makeNewYouthController({ newYouth: { send } as any });
    const body = { firstName: 'A' };
    expect(await c.send({ ctx: ACTOR, params: {}, query: {}, body })).toEqual({ student: 'sent', parent: 'sent', dryRun: false });
    expect(send).toHaveBeenCalledWith(ACTOR, body);
  });
  it('no session → Unauthorized', async () => {
    const c = makeNewYouthController({ newYouth: { send: vi.fn() } as any });
    await expect(c.send({ ctx: null, params: {}, query: {}, body: {} })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('routing', () => {
  it('vercel.json routes /intake to the API, not to index.html', async () => {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(new RegExp(cfg.routes[0].src).test('/intake/new-youth')).toBe(true);
  });
  it('the service worker never caches /intake', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('public/sw.js', 'utf8');
    const re = new Function(`${/const API_RE = [^\n]+/.exec(src)![0]}; return API_RE;`)() as RegExp;
    expect(re.test('/intake/new-youth')).toBe(true);
  });
  it('the route runs on its own timeouts, not the 20 s guard (a 503 there would invite a resend)', async () => {
    const { UNTIMED_ROUTES } = await import('../api/http/express-adapter');
    expect(UNTIMED_ROUTES.has('POST /intake/new-youth')).toBe(true);
  });
});
