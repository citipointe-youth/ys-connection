// I4 (R2-G2): Elvanto profile/form links open in the real browser from the installed app, with a target=_blank fallback.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const URL0 = 'https://example.org/admin/people/person/?id=x1';
const mk = (ua: string, standalone: boolean, visible = 'visible', touch = 0) => loadFns(['_isStandalone', '_extOpen'], `
  const navigator = { userAgent: ${JSON.stringify(ua)}, standalone: false, maxTouchPoints: ${touch} };
  const ls = {}; const on = (t, f) => { (ls[t] = ls[t] || []).push(f); }; const off = (t, f) => { ls[t] = (ls[t] || []).filter((g) => g !== f); };
  const window = { matchMedia() { return { matches: ${standalone} }; }, open(...a) { opened.push(a); }, addEventListener: on, removeEventListener: off };
  const location = { href: 'app' }; const opened = []; const timers = []; const toasts = [];
  const document = { visibilityState: ${JSON.stringify(visible)}, addEventListener: on, removeEventListener: off };
  let now = 1000; const Date = { now: () => now };
  function setTimeout(fn, ms) { timers.push([fn, ms]); }
  function toast(m) { toasts.push(m); }
  let _extArm = null;
  function __s() { return { location, opened, timers, toasts, document, ls, fire: (t) => (ls[t] || []).slice().forEach((f) => f()), tick: (ms) => { now += ms; } }; }`, ['_extOpen', '__s']);
const ev = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

describe('I4 _extOpen', () => {
  it('Android standalone: intent:// with a fallback URL', () => {
    const f = mk('Mozilla/5.0 (Linux; Android 14) Chrome/120', true), e = ev();
    expect(f._extOpen(e, URL0)).toBe(false);
    expect(e.prevented).toBe(true);
    const h = f.__s().location.href;
    expect(h.startsWith('intent://example.org/admin/')).toBe(true);
    expect(h).toContain('S.browser_fallback_url=https%3A%2F%2F');
    expect(h).toContain('scheme=https;package=com.android.chrome');
  });
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)';
  it('iOS 17 standalone: x-safari-https; leaving the app (hidden / pagehide / blur) means nothing more opens', () => {
    for (const leave of ['hidden', 'pagehide', 'blur']) {
      const f = mk(IOS, true), e = ev();
      expect(f._extOpen(e, URL0)).toBe(false);
      const s = f.__s();
      expect(s.location.href).toBe('x-safari-' + URL0);
      if (leave === 'hidden') { s.document.visibilityState = 'hidden'; s.fire('visibilitychange'); s.document.visibilityState = 'visible'; }
      else s.fire(leave);
      s.timers[0][0]();
      expect(s.opened).toEqual([]);
      expect(s.toasts).toEqual([]);
      expect(Object.values(s.ls).flat().length).toBe(0); // listeners removed
    }
  });
  it('iOS 17: the bug: the timer fires on return (page visible again, no event seen) -> still no in-app open', () => {
    const f = mk(IOS, true);
    f._extOpen(ev(), URL0);
    const s = f.__s();
    s.tick(60000); // timer was frozen while Safari was in front
    s.timers[0][0]();
    expect(s.opened).toEqual([]);
    expect(s.toasts).toEqual([]);
  });
  it('iOS 17: never left -> no auto open, a hint, and a second tap on the same link opens the in-app sheet', () => {
    const f = mk(IOS, true);
    f._extOpen(ev(), URL0);
    const s = f.__s();
    s.timers[0][0]();
    expect(s.opened).toEqual([]);
    expect(s.toasts.length).toBe(1);
    expect(f._extOpen(ev(), URL0)).toBe(false);
    expect(s.opened).toEqual([[URL0, '_blank', 'noopener']]);
    expect(s.timers.length).toBe(1); // no new Safari hand-off
  });
  it('iOS 17: the second tap is only armed for the same link and for 30 s', () => {
    const f = mk(IOS, true);
    f._extOpen(ev(), URL0);
    const s = f.__s();
    s.timers[0][0]();
    f._extOpen(ev(), URL0 + '2');
    expect(s.opened).toEqual([]);
    expect(s.location.href).toBe('x-safari-' + URL0 + '2');
    const g = mk(IOS, true);
    g._extOpen(ev(), URL0);
    const t = g.__s();
    t.timers[0][0]();
    t.tick(31000);
    g._extOpen(ev(), URL0);
    expect(t.opened).toEqual([]);
  });
  it('iOS 16 standalone keeps the default link', () => {
    const f = mk('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X)', true), e = ev();
    expect(f._extOpen(e, URL0)).toBe(true);
    expect(e.prevented).toBe(false);
    expect(f.__s().location.href).toBe('app');
  });
  // N05: iPadOS (Safari and Home Screen apps) sends the desktop Mac UA; only touch points tell it apart from a Mac.
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  it('N05 iPad installed app (desktop Mac UA + touch): the iOS path, x-safari then the second-tap hint', () => {
    const f = mk(IPAD, true, 'visible', 5), e = ev();
    expect(f._extOpen(e, URL0)).toBe(false);
    expect(e.prevented).toBe(true);
    const s = f.__s();
    expect(s.location.href).toBe('x-safari-' + URL0);
    s.timers[0][0]();
    expect(s.toasts).toEqual(["Didn't open? Tap the link again to open it here."]);
    expect(f._extOpen(ev(), URL0)).toBe(false);
    expect(s.opened).toEqual([[URL0, '_blank', 'noopener']]);
  });
  it('N05 a real Mac (same UA, no touch) keeps the default link', () => {
    const f = mk(IPAD, true, 'visible', 0), e = ev();
    expect(f._extOpen(e, URL0)).toBe(true);
    expect(e.prevented).toBe(false);
    expect(f.__s().location.href).toBe('app');
  });
  it('desktop / not installed, or a non-https URL: default link, location untouched', () => {
    for (const f of [mk('Mozilla/5.0 (Linux; Android 14)', false), mk('Mozilla/5.0 (Windows NT 10.0)', true)]) {
      expect(f._extOpen(ev(), URL0)).toBe(true);
      expect(f.__s().location.href).toBe('app');
    }
    expect(mk('Mozilla/5.0 (Linux; Android 14)', true)._extOpen(ev(), 'javascript:alert(1)')).toBe(true);
  });
  it('both Elvanto link sites use it, with no id or name in the handler', () => {
    const src = loadIndexHtml();
    expect(extractFn(src, '_ikCompareHtml')).toContain('target="_blank" rel="noopener" onclick="return _extOpen(event,this.href)"');
    expect(extractFn(src, '_ikOtherRow')).toContain('target="_blank" rel="noopener" onclick="return _extOpen(event,this.href)"');
  });
});
