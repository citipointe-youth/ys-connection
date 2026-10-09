import { describe, it, expect } from 'vitest';
import { cachedProbe } from '../utils/cached-probe';

describe('cachedProbe', () => {
  it('calls the probe at most once per 30 s', async () => {
    let calls = 0; let t = 0;
    const p = cachedProbe(async () => { calls++; return 'ok' as const; }, 30_000, () => t);
    await p(); await p(); t = 29_999; await p();
    expect(calls).toBe(1);
    t = 30_001; await p();
    expect(calls).toBe(2);
  });
  it('shares one in-flight call', async () => {
    let calls = 0;
    const p = cachedProbe(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return 1; }, 30_000);
    await Promise.all([p(), p(), p()]);
    expect(calls).toBe(1);
  });
});
