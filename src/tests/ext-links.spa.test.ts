// I4 (R2-G2): Elvanto profile/form links open in the real browser from the installed app, with a target=_blank fallback.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const URL0 = 'https://example.org/admin/people/person/?id=x1';
const mk = (ua: string, standalone: boolean, visible = 'visible') => loadFns(['_isStandalone', '_extOpen'], `
  const navigator = { userAgent: ${JSON.stringify(ua)}, standalone: false };
  const window = { matchMedia() { return { matches: ${standalone} }; }, open(...a) { opened.push(a); } };
  const location = { href: 'app' }; const opened = []; const timers = [];
  const document = { visibilityState: ${JSON.stringify(visible)} };
  function setTimeout(fn, ms) { timers.push([fn, ms]); }
  function __s() { return { location, opened, timers }; }`, ['_extOpen', '__s']);
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
  it('iOS 17 standalone: x-safari-https, and the timer opens the URL only while still visible', () => {
    const f = mk('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', true), e = ev();
    expect(f._extOpen(e, URL0)).toBe(false);
    const s = f.__s();
    expect(s.location.href).toBe('x-safari-' + URL0);
    expect(s.timers.length).toBe(1);
    s.timers[0][0]();
    expect(s.opened).toEqual([[URL0, '_blank', 'noopener']]);
    const g = mk('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', true, 'hidden');
    g._extOpen(ev(), URL0);
    g.__s().timers[0][0]();
    expect(g.__s().opened).toEqual([]);
  });
  it('iOS 16 standalone keeps the default link', () => {
    const f = mk('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X)', true), e = ev();
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
