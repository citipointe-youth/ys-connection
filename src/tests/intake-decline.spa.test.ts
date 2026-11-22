// Rev 24 SPA: Decline / Undo (intakeMark), the Declined chip, Waiting grey, Refresh for the week on screen. Fictional names only.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, loadFns } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const STAGES = HTML.match(/^const HUB_STAGES = .*$/m)![0];
const NAMES = ['esc', '_hubFold', '_hubAddDays', '_hubFriday', '_hubStage', '_hubStray', '_hubTextNext', '_hubReasons', '_hubNext', '_hubFamilies', '_hubModel', '_hubSearch',
  '_ikAct', '_ikOpenAct', '_ikChip', '_ikReasons', '_ikAnd', '_ikFormName', 'tidyName', '_ikClSplit', '_ikFixText',
  '_hubRows', '_hubM', '_hubSnapApply', '_hubChip', '_hubFamRow', '_icJs', '_hubDeclBtn', '_hubDeclHtml', '_hubDeclToggle', '_hubMarkRow', '_hubSaveTag', '_hubBodyHtml', '_hubBulkRows', '_hubBulkHtml',
  '_hubBulkBtn', '_hubTextAll', '_ikReadyRows', '_hubWk', '_hubInWeek', '_lkWeekStart', '_lkAddDays', '_hubSendHtml', '_hubRefresh', '_ikQSlot', '_ikQRow', '_ikClDecl', '_ikClDeclBtn'];
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (o: any = {}) => ({ key: P(1), status: 'ready', title: 'Ava Sample', reason: '', outcome: '', hasText: false, personId: P(1), family: null, actions: [], declined: false, ...o });

function env(I: any, o: { post?: (b: any) => any; fresh?: any } = {}) {
  const calls = { posts: [] as any[], toasts: [] as string[], draws: 0 };
  (globalThis as any).__d = { calls, post: o.post, fresh: o.fresh };
  const F = loadFns(NAMES, `${STAGES}
    const __d = globalThis.__d; const __I = ${JSON.stringify(I)}; const _ik = () => __I; const _ikSt = () => ({});
    const IK_FIX_REASON = {}; const _lk = {}; const _ikLk = (k) => (_lk[k] = _lk[k] || { kind: k, st: 'idle', res: null }); const _ikLkBusy = () => false;
    const _lkSeen = (x) => x; const _lkDay = (x) => x; const icS = () => ''; const _ikFormRowEnd = () => ''; const _ikClRow = () => ''; const _ikMisRow = () => '';
    const _usRows = []; const _ikLkGo = () => {}; const _hubLoad = () => {}; const _ikDraw = () => { __d.calls.draws++; };
    const toast = (m) => __d.calls.toasts.push(m); const _lkUuid = () => 'id-' + (__d.calls.posts.length + 1); const _ikQFind = () => null;
    const _ikOutcome = (rs, id) => (rs || []).find((r) => r.id === id) || null;
    const _ikPost = (items) => { __d.calls.posts.push({ p: '/link/batch', items }); return Promise.resolve(__d.post ? __d.post(items) : items.map((i) => ({ kind: 'action', id: i.id, outcome: 'saved' }))); };
    const API = { post: (p, b) => { __d.calls.posts.push({ p, b }); return Promise.resolve({}); } };`,
  ['_hubFamilies', '_hubModel', '_hubFamRow', '_hubDeclBtn', '_hubDeclHtml', '_hubBodyHtml', '_hubMarkRow', '_hubRefresh', '_hubReasons', '_ikQSlot', '_ik', '_hubM', '_ikClDeclBtn', '_ikLk']);
  return { F, calls, I: F._ik() };
}
const hub = (rows: any[], extra: any = {}) => ({ hub: { lists: { 'intake|2026-10-16': { date: '2026-10-16', rows } }, flows: [] }, hubQ: '', fixes: {}, ...extra });
const CUT = (y: string) => Date.parse(y + 'T06:30:00+10:00');

describe('Decline / Undo', () => {
  it('a Needs-you or Ready row gets Decline; a done row does not', () => {
    const { F } = env({});
    const M = F._hubModel({ lists: { 'intake|2026-10-16': { date: '2026-10-16', rows: [row({ key: P(1), status: 'ready' }), row({ key: P(2), personId: P(2), title: 'Bo Sample', status: 'needs-you', reason: 'Check the match' }),
      row({ key: P(3), personId: P(3), title: 'Cy Sample', status: 'done' })] } }, flows: [], mis: [] }, 0, CUT, {}, {});
    const html = M.fams.map((f: any, i: number) => F._hubFamRow(f, i)).join('');
    expect(html.match(/>Decline</g)!.length).toBe(2);
    expect(html).toContain(`_hubMarkRow(&quot;intake&quot;,&quot;2026-10-16&quot;,&quot;${P(1)}&quot;,'decline')`);
  });
  it('decline posts intakeMark, shows declined at once, leaves the list; Undo posts undo and brings it back', async () => {
    const { F, calls, I } = env(hub([row()]));
    const p = F._hubMarkRow('intake', '2026-10-16', P(1), 'decline');
    expect(I.decl[`intake|2026-10-16|${P(1)}`]).toBe(true); // optimistic, before the reply
    await p;
    expect(calls.posts[0].items[0]).toMatchObject({ type: 'intakeMark', payload: { mode: 'intake', date: '2026-10-16', row: P(1), mark: 'decline' } });
    expect(F._hubM().fams).toHaveLength(0);
    expect(F._hubM().declined.map((x: any) => x.row.title)).toEqual(['Ava Sample']);
    await F._hubMarkRow('intake', '2026-10-16', P(1), 'undo');
    expect(calls.posts[1].items[0].payload.mark).toBe('undo');
    expect(F._hubM().fams).toHaveLength(1);
    expect(F._hubM().declined).toHaveLength(0);
  });
  it('a refused post puts the row back and says why', async () => {
    const { F, calls, I } = env(hub([row()]), { post: (items: any[]) => items.map((i) => ({ kind: 'action', id: i.id, outcome: 'refused', message: 'Refresh first.' })) });
    await F._hubMarkRow('intake', '2026-10-16', P(1), 'decline');
    expect(I.decl[`intake|2026-10-16|${P(1)}`]).toBeUndefined();
    expect(calls.toasts.at(-1)).toBe('Refresh first.');
    expect(F._hubM().fams).toHaveLength(1);
  });
  it('offline (the post throws, nothing kept): reverted with the error, like other saves', async () => {
    const { F, calls, I } = env(hub([row()]), { post: () => { throw new Error('Offline'); } });
    await F._hubMarkRow('intake', '2026-10-16', P(1), 'decline');
    expect(I.decl[`intake|2026-10-16|${P(1)}`]).toBeUndefined();
    expect(calls.toasts.at(-1)).toBe('Offline');
  });
  it('the server flag declined:true also hides the row; a kept intakeMark has its own queue slot', () => {
    const { F } = env(hub([row({ declined: true })]));
    expect(F._hubM().fams).toHaveLength(0);
    expect(F._ikQSlot({ type: 'intakeMark', payload: { date: 'd', row: 'r' } })).toBe('intakeMark|d|r');
  });
});

describe('Declined chip', () => {
  const rows = () => [row({ key: P(1), status: 'needs-you', reason: 'Check the match' }), row({ key: P(2), personId: P(2), title: 'Bo Sample', declined: true }), row({ key: P(3), personId: P(3), title: 'Cy Sample', status: 'ready', declined: true })];
  it('counts declined apart; the default view has no declined row, the chip view has only them, each with Undo and no Save / Text', () => {
    const { F, I } = env(hub(rows()));
    const main = F._hubBodyHtml();
    expect(main).toContain('Declined (2)');
    expect(main).toContain('Needs action (1)');
    expect(main).not.toContain('Bo Sample');
    expect(main).not.toContain('Cy Sample');
    I.hubDeclView = true;
    const only = F._hubBodyHtml();
    expect(only).toContain('Bo Sample');
    expect(only).toContain('Cy Sample');
    expect(only).not.toContain('Ava Sample');
    expect(only.match(/>Undo</g)!.length).toBe(2);
    expect(only).not.toMatch(/Save|Text all|Decline</);
  });
  it('declined ready rows are not in Save all', () => {
    const { F } = env(hub(rows().filter((r) => r.key !== P(1))));
    expect(F._hubBodyHtml()).not.toContain('Save all');
  });
});

describe('Waiting grey', () => {
  const W = 'Waiting for replies until Friday 9 am';
  it('a Waiting needs-you row is a waiting reason: grey, and not counted in Needs action', () => {
    const { F } = env(hub([row({ status: 'needs-you', reason: W })]));
    const M = F._hubM();
    expect(M.fams[0].reasons).toBeUndefined();
    expect(M.fams[0].kids[0].reasons[0][0]).toBe('waiting');
    expect(M.fams[0].needs).toBe(false);
    const html = F._hubFamRow(M.fams[0], 0);
    expect(html).toContain('lk-st grey');
    expect(F._hubBodyHtml()).toContain('Needs action (0)');
  });
  it('another needs-you reason still counts', () => {
    const { F } = env(hub([row({ status: 'needs-you', reason: 'Check the match' })]));
    expect(F._hubM().fams[0].needs).toBe(true);
    expect(F._hubBodyHtml()).toContain('Needs action (1)');
  });
});

describe('Refresh asks only the week on screen', () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
  const ago = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
  const lists = () => ({ ['intake|' + today]: {}, ['consent|' + today]: {}, ['intake|' + ago(14)]: {}, ['intake|' + ago(28)]: {} });
  const asks = (c: any) => c.posts.filter((x: any) => x.p === '/link/intake/refresh').map((x: any) => x.b.mode + '|' + x.b.date).sort();
  it('Current week: only the dates of that week, and a single week shows no count', async () => {
    const { F, calls, I } = env({ hub: { lists: lists(), snap: { live: true } }, hubWk: 'cur' });
    const p = F._hubRefresh();
    expect(I.hubWeek).toEqual({ x: 1, y: 1 });
    await p;
    expect(asks(calls)).toEqual(['consent|' + today, 'intake|' + today]);
  });
  it('All: every week, newest first; the live label reads "(week x of y)" while it runs', async () => {
    const { F, calls, I } = env({ hub: { lists: lists(), snap: { live: true } }, hubWk: 'all' });
    const p = F._hubRefresh();
    expect(I.hubWeek).toEqual({ x: 1, y: 3 });
    await p;
    expect(asks(calls)).toHaveLength(4);
    expect(HTML).toContain("'Updating…' + (I.hubWeek && I.hubWeek.y > 1 ? ' (week ' + I.hubWeek.x + ' of ' + I.hubWeek.y + ')' : '')");
  });
});

describe('22 Nov: Decline an unmatched consent form', () => {
  const form = (o: any = {}) => ({ subId: P(7), name: 'Sample, Zed', submitted: '2026-10-20', status: 'pending', linked: null, declined: false, ...o });
  const withForms = (fs: any[]) => { const r = env(hub([])); r.F._ikLk('unlinked').res = { rows: fs }; return r; };
  it('the button shows only for a console that sends declined, an unlinked form with a date, nothing on the way', () => {
    const { F } = env({});
    expect(F._ikClDeclBtn(form(), false, null)).toContain(`_hubMarkRow(&quot;form&quot;,&quot;2026-10-20&quot;,&quot;${P(7)}&quot;,&quot;decline&quot;)`);
    const { declined: _d, ...old } = form();
    expect(F._ikClDeclBtn(old, false, null)).toBe('');
    expect(F._ikClDeclBtn(form({ submitted: null }), false, null)).toBe('');
    expect(F._ikClDeclBtn(form(), true, null)).toBe('');
    expect(F._ikClDeclBtn(form(), false, { personId: P(1) })).toBe('');
  });
  it('decline posts intakeMark mode form; the form leaves Needs action and sits under Declined with Undo', async () => {
    const { F, calls, I } = withForms([form()]);
    await F._hubMarkRow('form', '2026-10-20', P(7), 'decline');
    expect(calls.posts[0].items[0]).toMatchObject({ type: 'intakeMark', payload: { mode: 'form', date: '2026-10-20', row: P(7), mark: 'decline' } });
    expect(F._hubM().declined).toEqual([{ mode: 'form', date: '2026-10-20', row: { key: P(7), title: 'Zed Sample' } }]);
    I.hubDeclView = true;
    expect(F._hubBodyHtml()).toContain('Consent form filled in 2026-10-20');
  });
  it('the console flag declined:true alone also declines it', () => {
    const { F } = withForms([form({ declined: true })]);
    expect(F._hubM().declined).toHaveLength(1);
    expect(F._hubBodyHtml()).toContain('Declined (1)');
  });
});
