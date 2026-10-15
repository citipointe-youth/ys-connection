// Fix round 16 Oct 2026, lane C (Home / More / Admin / Bus). Extract-and-run against public/index.html.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const fn = (n: string) => extractFn(HTML, n);

describe('fix16 lane C', () => {
  it('F-31: setup help no longer mentions the Practice or Live switch', () => {
    expect(fn('_setupIntakeHtml')).not.toContain('Practice or Live');
  });

  it('F-43: the Preview eye sits apart from lock and delete (first, with a 16px gap)', () => {
    const src = fn('renderAdminView');
    const eye = src.indexOf("confirmEnterPreview('${u.id}')");
    const edit = src.indexOf("showEditUser('${u.id}')");
    const lock = src.indexOf("toggleUserStatus('${u.id}'");
    const del = src.indexOf("confirmDelUser('${u.id}')");
    expect(eye).toBeGreaterThan(0);
    expect(eye).toBeLessThan(edit);
    expect(edit).toBeLessThan(lock);
    expect(lock).toBeLessThan(del);
    expect(src.slice(eye - 200, eye)).toContain('margin-right:16px');
  });

  it('F-46(a): preview confirm reads "Preview as X?" with Cancel on the left', () => {
    let html = '';
    const run = new Function('modal', 'esc', '_adminData', `${fn('confirmEnterPreview')}; confirmEnterPreview('a1');`);
    run((h: string) => { html = h; }, (s: string) => s, { users: [{ id: 'a1', displayName: 'Junior Guys' }] });
    expect(html).toContain('Preview as <strong>Junior Guys</strong>?');
    expect(html).not.toContain('Preview Account');
    expect(html.indexOf('Cancel')).toBeLessThan(html.indexOf('>Preview<'));
  });

  it('F-46(a) / L4-14: one name for the console machine', () => {
    expect(HTML).not.toContain('the console computer has not picked them up');
    expect(HTML).toContain("Actions waited a day: the console PC hasn't picked them up.");
  });

  it('F-47(b): Home no longer shows a permanent "All students are connected!"', () => {
    expect(fn('_renderHomeInner')).not.toContain('All students are connected');
  });

  it('F-48(e): Bus "I am:" never wraps', () => {
    const src = fn('_busMyCarHtml');
    expect(src.match(/<span style="white-space:nowrap">I am:<\/span>/g)?.length).toBe(2);
  });

  describe('GAP-1: Check-in tile on Home on a service day', () => {
    const tile = (on: boolean, today: string, dow = 5) => new Function('_linkOn', '_lkSvcDay', '_serviceDow', 'icN', 'esc',
      `${fn('_homeCheckinTile')}; return _homeCheckinTile();`)(
      (f: string) => on && f === 'checkin', () => today, () => dow, (k: string) => `<i ${k}>`, (s: string) => s);
    it('shows on the service day when check-in is allowed', () => {
      const h = tile(true, '2026-10-16'); // a Friday
      expect(h).toContain("go('link-checkin')");
      expect(h).toContain('Check-in');
    });
    it('hidden on other days or when check-in is off', () => {
      expect(tile(true, '2026-10-15')).toBe('');
      expect(tile(false, '2026-10-16')).toBe('');
      expect(tile(true, '2026-10-15', 4)).toContain('Check-in'); // follows serviceDayOfWeek
    });
    it('Home renders it', () => {
      expect(fn('_renderHomeInner')).toContain('_homeCheckinTile()');
    });
  });
});
