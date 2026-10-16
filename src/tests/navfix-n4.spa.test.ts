// Fix round 2026-10-16 lane n4 (SPA): Unsent retry busy (C-B2), New person result kept (C-B5),
// New person request id + unsent marker (C-B9/D3), door wording (B10, D6), _lkBoot intake flush.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();
const fns = (names: string[]) => names.map((n) => extractFn(html, n)).join('\n');

describe('C-B2 Unsent retry: a re-render during the retry keeps the button busy', () => {
  function setup(post: () => Promise<any>) {
    const els: Record<string, any> = {};
    const env: any = { toasts: [] as string[], loads: 0 };
    const f = new Function('env', 'els', 'post', `
      const document = { getElementById: (id) => els[id] || null };
      const esc = (s) => String(s), _laFmtBrisbane = (s) => s, _laRelTime = (s) => s;
      const toast = (m) => env.toasts.push(m), _nyMessage = () => ({ lines: ['ok'] });
      const API = { post };
      const US_REASON = {};
      const _usBusy = new Set();
      let _usRows = [{ id: 'u1', name: 'A B', reason: 'failed', forms: ['student'], createdAt: 'x', updatedAt: 'x' }];
      async function _usLoad() { env.loads++; }
      ${extractFn(html, '_usRowHtml')}
      ${extractFn(html, 'usRetry')}
      return { _usRowHtml, usRetry, rows: () => _usRows };`);
    return { ...f(env, els, post), env, els };
  }

  it('row drawn while a retry is in flight has a disabled Sending... button; after the reply it is enabled', async () => {
    let done!: (v: any) => void;
    const t = setup(() => new Promise((r) => { done = r; }));
    t.els['us-retry-u1'] = { disabled: false, dataset: {}, textContent: 'Retry' };
    const p = t.usRetry('u1');
    const mid = t._usRowHtml(t.rows()[0]);
    expect(mid).toMatch(/id="us-retry-u1"[^>]*disabled/);
    expect(mid).toContain('Sending...');
    // a fresh button (re-render) tapped again: ignored, no second POST
    t.els['us-retry-u1'] = { disabled: false, dataset: {}, textContent: 'Retry' };
    let posts = 0;
    await t.usRetry('u1').then(() => posts++);
    expect(t.env.loads).toBe(0); // the second tap returned before posting/reloading
    done({ student: 'sent', parent: 'sent' });
    await p;
    const after = t._usRowHtml(t.rows()[0]);
    expect(after).not.toMatch(/disabled/);
    expect(after).toContain('>Retry<');
    expect(posts).toBe(1);
  });
  it('the busy set is declared at top level', () => {
    expect(html).toMatch(/^const _usBusy = new Set\(\);/m);
  });
});
