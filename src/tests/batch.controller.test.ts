import { describe, it, expect } from 'vitest';
import { makeBatchController } from '../api/controllers/batch.controller';
import { UnauthorizedError, BadRequestError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';
import type { HttpRequest } from '../api/http/types';

function actor(role = 'admin'): Actor {
  return { id: 'a-test', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

function req(sections: string | undefined, ctx: Actor | null = actor()): HttpRequest {
  return { ctx, params: {}, query: { sections }, body: undefined };
}

// Stub services that record the ctx they were called with, so we can assert the
// controller delegates (and forwards the actor) rather than reimplementing anything.
// `throwing` lets a named section reject to exercise the allSettled isolation.
function makeStubbed(throwing: string[] = []) {
  const calls: Record<string, Actor | 'noctx'> = {};
  const rec = (name: string, val: unknown) => (ctx?: Actor) => {
    calls[name] = ctx ?? 'noctx';
    if (throwing.includes(name)) return Promise.reject(new Error(`${name} boom`));
    return Promise.resolve(val);
  };
  const deps = {
    overview: { getStats: rec('overview', { kpi: 1 }) },
    trends: { get: rec('trends', { series: [] }) },
    student: { list: (ctx: Actor) => rec('students', [{ id: 's1' }])(ctx) },
    lifegroupStats: { get: rec('lifegroupStats', { groups: [] }) },
    connection: { listAll: rec('connections', [{ id: 'c1' }]) },
    atRisk: { list: rec('atRisk', [{ id: 'r1' }]) },
    settings: { get: rec('settings', { termGapDays: 14 }) },
    leader: { list: rec('leaders', [{ id: 'l1' }]) },
  } as unknown as Parameters<typeof makeBatchController>[0];
  return { ctrl: makeBatchController(deps), calls };
}

describe('batch controller', () => {
  it('composes the requested sections into results', async () => {
    const { ctrl } = makeStubbed();
    const out = (await ctrl.get(req('overview,connections,settings'))) as {
      results: Record<string, unknown>;
      errors: Record<string, string>;
    };
    expect(Object.keys(out.results).sort()).toEqual(['connections', 'overview', 'settings']);
    expect(out.results['overview']).toEqual({ kpi: 1 });
    expect(out.results['connections']).toEqual([{ id: 'c1' }]);
    expect(out.errors).toEqual({});
  });

  it('puts unknown sections in errors but still returns the known ones', async () => {
    const { ctrl } = makeStubbed();
    const out = (await ctrl.get(req('overview,bogus'))) as {
      results: Record<string, unknown>;
      errors: Record<string, string>;
    };
    expect(out.results['overview']).toEqual({ kpi: 1 });
    expect(out.errors['bogus']).toBe('unknown section');
    expect(out.results['bogus']).toBeUndefined();
  });

  it('isolates a failing section (allSettled) — siblings still succeed', async () => {
    const { ctrl } = makeStubbed(['trends']);
    const out = (await ctrl.get(req('overview,trends,leaders'))) as {
      results: Record<string, unknown>;
      errors: Record<string, string>;
    };
    expect(out.results['overview']).toEqual({ kpi: 1 });
    expect(out.results['leaders']).toEqual([{ id: 'l1' }]);
    expect(out.errors['trends']).toMatch(/boom/);
    expect(out.results['trends']).toBeUndefined();
  });

  it('forwards the actor ctx to each section service (RBAC delegated, not bypassed)', async () => {
    const { ctrl, calls } = makeStubbed();
    const a = actor('grade');
    await ctrl.get(req('overview,connections,atRisk,students', a));
    expect(calls['overview']).toBe(a);
    expect(calls['connections']).toBe(a);
    expect(calls['atRisk']).toBe(a);
    expect(calls['students']).toBe(a);
  });

  it('deduplicates repeated section keys', async () => {
    const { ctrl } = makeStubbed();
    const out = (await ctrl.get(req('overview,overview,overview'))) as {
      results: Record<string, unknown>;
    };
    expect(Object.keys(out.results)).toEqual(['overview']);
  });

  it('rejects a missing sections param with BadRequestError', async () => {
    const { ctrl } = makeStubbed();
    await expect(ctrl.get(req(undefined))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects an unauthenticated request', async () => {
    const { ctrl } = makeStubbed();
    await expect(ctrl.get(req('overview', null))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
