// Round 2026-10-21 L1 (YS UI tidy): Setup leader cards show ~3.5 students in the same outer size, compact Accounts rows
// on a phone, Change password only in a junior leader's More, a single More module keeps its own tab (Check-in bug),
// and the Setup leader search for Junior/Senior (quad) logins.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const css = (sel: string) => {
  const i = HTML.indexOf('\n' + sel + '{');
  expect(i, sel).toBeGreaterThan(-1);
  return HTML.slice(i + 1, HTML.indexOf('}', i));
};
const px = (rule: string, prop: string) => {
  const m = rule.match(new RegExp('(?:^|[{;])' + prop + ':(\\d+)px'));
  expect(m, rule + ' / ' + prop).not.toBeNull();
  return Number(m![1]);
};

describe('L1-1 Setup leader cards: same outer size, ~3.5 student rows', () => {
  it('the header is two 44px rows (name + edit; meta + count + Add Students)', () => {
    const src = extractFn(HTML, 'renderConnectView');
    expect(src).toContain('<div class="connect-leader-head">');
    expect(src).toContain('<div class="connect-leader-sub">');
    // the count sits on the meta line, the Add button on the same row
    expect(src).toMatch(/connect-leader-sub">\s*<span class="connect-leader-meta">[^\n]*student\$\{n!==1\?'s':''\}<\/span><\/span>\s*\$\{canEdit\?`<button class="connect-add-btn"/);
    expect(css('.connect-add-btn')).toContain('min-height:44px');
    expect(css('.connect-add-btn')).toContain('flex:none');
  });
  it('>= 540px (2-3 column grid) keeps the full meta line with the Add bar below it', () => {
    expect(HTML).toContain('@media(min-width:540px){.connect-leader-sub{flex-wrap:wrap;row-gap:10px}.connect-leader-meta{flex-basis:100%;justify-content:space-between}.connect-add-btn{flex:1 1 100%;font-size:14px}}');
  });
  it('student rows are 39px (38 + rule) with 36px Profile/remove buttons; the list window shows 3.5 rows', () => {
    const row = px(css('.connect-stud-row'), 'min-height');
    expect(row).toBeGreaterThanOrEqual(36);
    expect(css('.connect-stud-row .btn-sm')).toContain('min-height:36px');
    const list = css('.connect-students');
    const rows = (px(list, 'max-height') - 4) / row; // padding-top 4; border-box rows include their 1px rule
    expect(rows).toBeGreaterThan(3.3);
    expect(rows).toBeLessThan(3.7);
    expect(list).toContain('padding:4px 10px 0 0');
    expect(css('.connect-students-track')).toContain('top:5px');
  });
  it('the card keeps its outer size (old: 32 pad + 44 + 26 meta + 39 add + 12 + 126 list = 279px)', () => {
    const list = px(css('.connect-students'), 'max-height');
    const gap = px(css('.connect-leader-head'), 'margin-bottom');
    const top = px(css('.connect-students-wrap'), 'margin-top');
    const h = 32 + 44 + gap + 44 + top + list;
    expect(Math.abs(h - 279)).toBeLessThanOrEqual(4);
  });
});

describe('L1-2 Accounts rows on a phone', () => {
  it('under 600px a row is one line: name/username left, icons right, pill in the username row, text ellipsised', () => {
    const m = HTML.match(/@media\(max-width:599px\)\{\.rc\.rc-row\{([^}]*)\}([^\n]*)/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('display:grid');
    expect(m![1]).toContain('grid-template-rows:auto auto');
    expect(m![1]).toContain('grid-auto-flow:column');
    expect(m![1]).toContain('margin-bottom:var(--s1)');
    expect(m![2]).toContain('.rc-row>.rc-main,.rc-row>.rc-foot{display:contents}');
    expect(m![2]).toContain('.rc-row .lk-nm,.rc-row .lk-d{grid-column:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}');
    expect(m![2]).toContain('.rc-row .lk-nm{grid-row:1;');
    expect(m![2]).toMatch(/\.rc-row \.lk-d\{grid-row:2;[^}]*padding-right:64px\}/);
    // the pill shares the username row only, so it can never overlap the name line
    expect(m![2]).toContain('.rc-row>.rc-foot>.chip{grid-column:1;grid-row:2;justify-self:end;');
    expect(m![2]).toContain('.rc-row>.rc-foot>.btn{grid-row:1/span 2}');
  });
  it('the Preview gap is a class (the phone rule drops it), not an inline style', () => {
    expect(HTML).toContain('class="btn btn-ghost btn-sm acct-pv" onclick="confirmEnterPreview(');
    expect(HTML).not.toContain('style="margin-right:16px" onclick="confirmEnterPreview(');
    expect(HTML).toContain('.rc-icons>.acct-pv{margin-right:16px}');
  });
});

describe('L1-3/L1-extra More, Change password and Check-in', () => {
  const NAV = ['_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', '_busOn', '_prayersOn', 'moreItems', '_navItemsBase', '_navSlots', 'navItems', 'bottomNavItems', '_navClick', 'openMore'];
  const nav = (role: string, modules: any) => {
    let shown = '';
    const n = new Function('S', 'L', 'modal', 'icN', 'esc', `${NAV.map((x) => extractFn(HTML, x)).join('\n')}; return { navItems, bottomNavItems, moreItems, openMore };`)(
      { user: { role }, page: 'home', settings: { ministryConfig: { modules } } }, (k: string) => k, (h: string) => { shown = h; }, (k: string) => `<i ${k}>`, (x: string) => x);
    return { n, shown: () => shown };
  };
  const ids = (xs: any[]) => xs.map((i) => i.id);
  it('More has no Change password row except for a junior leader (Setup has it)', () => {
    for (const r of ['admin', 'director', 'quad', 'grade']) {
      const e = nav(r, { busMinistry: true });
      e.n.openMore();
      expect(e.shown(), r).toContain("go('bus')");
      expect(e.shown(), r).not.toContain('showChangeOwnPassword');
    }
    const l = nav('leader', {});
    l.n.openMore();
    expect(l.shown()).toContain('showChangeOwnPassword()');
  });
  it('every login can reach Change password: a junior leader by More, the rest by Setup in the bottom bar', () => {
    expect(extractFn(HTML, 'renderConnectView')).toContain('onclick="showChangeOwnPassword()"');
    for (const r of ['admin', 'director', 'quad', 'grade']) {
      for (const modules of [{}, { prayers: false }, { busMinistry: true }]) expect(ids(nav(r, modules).n.bottomNavItems()), r).toContain('leaders');
    }
    for (const modules of [{}, { prayers: false }]) expect(ids(nav('leader', modules).n.bottomNavItems())).toContain('more');
  });
  it('one extra screen, Prayers off: that screen is the tab (Check-in was wrongly New person)', () => {
    const cases: [any, string, string][] = [
      [{ prayers: false, checkin: 'on' }, 'link-checkin', "go('link-checkin')"],
      [{ prayers: false, lifegroupReport: 'on' }, 'link-groups', "go('link-groups')"],
      [{ prayers: false, flows: 'on' }, 'link-flows', "go('link-flows')"],
      [{ prayers: false, newYouthForms: 'on', checkin: 'off', lifegroupReport: 'off', flows: 'off' }, 'new-youth', 'nyOpen()'],
    ];
    for (const r of ['grade', 'quad', 'director']) {
      for (const [modules, id, click] of cases) {
        const n = nav(r, modules).n;
        expect(ids(n.moreItems()), r + id).toEqual([id]);
        const it = n.bottomNavItems().find((i: any) => i.id === id);
        expect(it, r + ' ' + id).toBeTruthy();
        expect(it.action ? it.action : `go('${it.id}')`).toBe(click);
        expect(it.ic).toBe(n.moreItems()[0].ic);
        if (id !== 'new-youth') expect(it.mbl, id).toMatch(/^[A-Z][a-z-]+$/); // one short word in the bottom bar
      }
    }
    expect(nav('admin', { prayers: false, intakeAdmin: 'on' }).n.bottomNavItems().find((i: any) => i.id === 'link-intake')).toMatchObject({ mbl: 'Intake' });
    expect(nav('grade', { prayers: false, lifegroupReport: 'on' }).n.bottomNavItems().find((i: any) => i.id === 'link-groups')).toMatchObject({ mbl: 'Report' });
  });
  it('Check-in on: every login reaches it (tab or More)', () => {
    for (const r of ['admin', 'director', 'quad', 'grade', 'leader']) {
      for (const modules of [{ checkin: 'on' }, { checkin: 'on', prayers: false }, { checkin: 'on', busMinistry: true }]) {
        const n = nav(r, modules).n;
        const reach = ids(n.navItems()).includes('link-checkin') || (ids(n.navItems()).includes('more') && ids(n.moreItems()).includes('link-checkin'));
        expect(reach, r + JSON.stringify(modules)).toBe(true);
      }
    }
  });
});

describe('L1-4 Setup leader search for Junior/Senior logins', () => {
  const mk = (role: string, lq = '') => loadFns(['renderConnectView'], `
    let html = '';
    const _aS = { students: [], allocs: {}, gf: new Set(), df: new Set(), lq: ${JSON.stringify(lq)},
      leaders: [{ id: 'l1', fullName: 'Amy Test', grades: [8], gender: 'female' }, { id: 'l2', fullName: 'Ann Sample', grades: [9], gender: 'female' }] };
    const S = { user: { role: ${JSON.stringify(role)}, quad: 'g79' } };
    function _vgActive() { return false; } function _vgGrades() { return []; } function _vgLeaders(l) { return l; } function _vgStudents(s) { return s; }
    function _vgBar() { return ''; } function userGrades() { return [8]; } function _hasAttended() { return true; }
    function quadGrades() { return [7, 8, 9]; } function _gradeList() { return [7, 8, 9]; } function _pickByFirst() { return 0; }
    function helpTip() { return ''; } function esc(s) { return String(s); }
    function icS() { return ''; } function icEmpty() { return ''; } function _inactiveLeadersHtml() { return ''; }
    function shell(b) { return b; } function setApp(h) { html = h; }
    const document = { activeElement: null, querySelectorAll() { return []; }, getElementById() { return null; } };
    function _syncConnectThumb() {}
    function __html() { return html; }`, ['renderConnectView', '__html']);
  it('a quad login gets the same search box (one _csLeaderQ) and a repaint keeps the filter; no gender chips', () => {
    const f = mk('quad', 'ann');
    f.renderConnectView();
    const h = f.__html();
    expect(h).toContain('id="cs-lq"');
    expect(h).toContain('oninput="_csLeaderQ(this.value)"');
    expect(h).toMatch(/data-name="amy test" style="display:none"/);
    expect(h).toMatch(/data-name="ann sample">/);
    expect(h).not.toContain('Gender:');
    expect(HTML.match(/function _csLeaderQ\(/g)).toHaveLength(1);
  });
});
