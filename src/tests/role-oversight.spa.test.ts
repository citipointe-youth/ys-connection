// Phase 1 (oversight): the SPA treats role 'oversight' exactly as it treated 'director'.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();

describe('oversight role in the SPA', () => {
  it('no "director" word is left in the page', () => {
    expect(HTML.match(/\bdirector\b/gi) ?? []).toEqual([]);
  });

  it('the Oversight label is fixed', () => {
    const m = /const _ROLE_LABEL_DEFAULTS = (\{[^}]*\});/.exec(HTML)!;
    const labels = new Function(`return ${m[1]}`)();
    expect(labels.oversight).toBe('Oversight');
    expect(labels.director).toBeUndefined();
  });

  it('More holds Import for an oversight login, and _navSlots keeps a More slot', () => {
    const S = { user: { role: 'oversight' }, settings: null };
    const run = new Function(
      'S', '_prayersOn', '_busOn', '_nyOn', '_linkOn', 'L', '_navItemsBase',
      `${extractFn(HTML, 'moreItems')}\n${extractFn(HTML, '_navSlots')}\nreturn { more: moreItems(), slots: _navSlots(S.user) };`,
    );
    const out = run(S, () => false, () => false, () => false, () => false, (k: string) => k,
      () => [{ id: 'home' }, { id: 'prayers' }]);
    expect(out.more.map((x: any) => x.id)).toContain('import');
    expect(out.slots.map((x: any) => x.id)).toContain('more');
  });
});
