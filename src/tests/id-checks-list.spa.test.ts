// ID Checks list + leader pages (Task 13): pills, empty states, Resume, author-only Edit, two-tap Delete, "Last time",
// the cache bypass and escaping. Real function bodies from public/index.html, stubbed scope.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['esc', '_icJs', '_icSectionTitle', '_icGet', '_icListHtml', '_icLastTime', '_icEntryBody', '_icHistCard', '_icLeaderHtml', '_icDelete', '_icWaitFlying', '_icDraftKey'];
const CONSTS = ['_IC', '_IC_PILL', '_IC_BTN'].map((n) => HTML.match(new RegExp(`^const ${n} = .*$`, 'm'))![0]).join('\n');

function load(env: Record<string, any> = {}) {
  const scope = { fmtDay: (v: string) => 'D:' + v, icS: (k: string) => '<i>' + k + '</i>', S: { user: { id: 'u1', role: 'oversight' } }, ...env };
  const src = FNS.map((n) => extractFn(HTML, n)).join('\n');
  return new Function('__env', `with (__env) { ${CONSTS}\n${src}\n return { ${FNS.join(', ')}, _IC }; }`)(scope) as Record<string, any>;
}
const F = load();

const row = (o: Record<string, any> = {}) => ({ id: 'l1', name: 'Sample Dummyton', gender: 'female', grades: [8], lastCheckOn: '2026-10-16', dueOn: '2027-02-15', status: 'onTrack', inProgress: null, ...o });
const list = (leaders: any[], cycleStart = '2026-10-01') => ({ leaders, questions: [], rhythm: { cycleStart, intervalMonths: 4 }, today: '2026-10-30' });

describe('list page', () => {
  it('one pill per status', () => {
    const want: Record<string, string> = {
      overdue: '<span class="pill bad">Overdue</span>', dueSoon: '<span class="pill warn">Due soon</span>',
      never: '<span class="pill neutral">Never</span>', onTrack: '<span class="pill ok">On track</span>',
    };
    for (const [st, pill] of Object.entries(want)) expect(F._icListHtml(list([row({ status: st })]), false), st).toContain(pill);
  });
  it('an unfinished check adds an In progress pill beside the status pill', () => {
    const h = F._icListHtml(list([row({ status: 'overdue', inProgress: { entryId: 'e1', authorName: 'Codeman', mine: false } })]), false);
    expect(h).toContain('<span class="pill bad">Overdue</span><span class="pill info">In progress</span>');
    expect(F._icListHtml(list([row()]), false)).not.toContain('In progress');
  });
  it('meta line: Last check and Due, no Last check part when never checked', () => {
    expect(F._icListHtml(list([row()]), false)).toContain('Last check D:2026-10-16 · Due D:2027-02-15');
    const h = F._icListHtml(list([row({ lastCheckOn: null, status: 'never' })]), false);
    expect(h).toContain('>Due D:2027-02-15<');
    expect(h).not.toContain('Last check');
  });
  it('empty states per role; Assign leaders only for an admin', () => {
    const o = F._icListHtml(list([]), false), a = F._icListHtml(list([]), true);
    expect(o).toContain('No leaders are ticked for you yet. Ask the admin.');
    expect(a).toContain('No leaders are ticked for you yet. Use Assign leaders below.');
    expect(o).not.toContain('Assign leaders');
    expect(a).toMatch(/onclick="go\('idcheck-grid'\)">Assign leaders</);
  });
  it('no start date: a plain note for oversight, a Set the start date button for admin, never-checked reads Due now', () => {
    const o = F._icListHtml(list([row(), row({ id: 'l2', lastCheckOn: null, status: 'never', dueOn: '2026-10-30' })], ''), false);
    expect(o).toContain('No start date is set yet, so due dates count from each last check.');
    expect(o).not.toContain('_icSetStart');
    expect(o).toContain('>Due now<');
    expect(o).toContain('Last check D:2026-10-16 · Due D:2027-02-15');
    const a = F._icListHtml(list([row()], ''), true);
    expect(a).toContain('onclick="_icSetStart()">Set the start date<');
    expect(F._icListHtml(list([row()]), true)).not.toContain('start date');
    expect(F._icListHtml(list([row({ lastCheckOn: null, status: 'never' })]), false)).toContain('>Due D:2027-02-15<');
  });
});

const chk = (o: Record<string, any> = {}) => ({ id: 'c1', leaderId: 'l1', leaderName: 'Sample Dummyton', kind: 'check', heldOn: '2026-10-20', finished: false, authorId: 'u1', authorName: 'Ova Sight', mine: true, content: { answers: {}, nextTime: '' }, createdAt: '', updatedAt: '2026-10-20T01:00:00Z', ...o });
const leaderData = (entries: any[]) => ({
  leader: { id: 'l1', name: 'Sample Dummyton' }, entries,
  questions: [{ key: 'faith', title: 'FAITH', subtitle: 'their walk with God', questions: [{ key: 'faith01', text: 'How is it going?' }] }],
});

describe('leader page', () => {
  it('Start ID check with no own unfinished check; Resume opens the own one', () => {
    const start = F._icLeaderHtml(leaderData([chk({ finished: true })]), 'u1');
    expect(start).toContain(`onclick="_icNew('check')">Start ID check<`);
    const resume = F._icLeaderHtml(leaderData([chk({ id: 'c2' }), chk({ finished: true })]), 'u1');
    expect(resume).toContain(`onclick="_icEdit(&quot;c2&quot;)">Resume ID check<`);
    // someone else's unfinished check is not a Resume for me
    const other = F._icLeaderHtml(leaderData([chk({ mine: false, authorId: 'u2', authorName: 'Codeman' })]), 'u1');
    expect(other).toContain('Start ID check');
    expect(other).toContain('In progress (Codeman)');
  });
  it('Add note, Export and the safeguarding line', () => {
    const h = F._icLeaderHtml(leaderData([]), 'u1');
    expect(h).toContain(`onclick="_icNew('note')">Add note<`);
    expect(h).toContain(`onclick="_icExportOpen(&quot;l1&quot;)">Export<`);
    expect(h).toContain("Worried about someone's safety? Follow the safeguarding policy, not this app.");
  });
  it('Edit only on own entries; Delete on every entry', () => {
    const h = F._icLeaderHtml(leaderData([chk({ id: 'mine1' }), chk({ id: 'theirs1', mine: false, authorId: 'u2', authorName: 'Codeman' })]), 'u1');
    expect(h).toContain(`_icEdit(&quot;mine1&quot;)`);
    expect(h).not.toContain(`_icEdit(&quot;theirs1&quot;)`);
    expect(h).toContain(`_icDelete(&quot;mine1&quot;)`);
    expect(h).toContain(`_icDelete(&quot;theirs1&quot;)`);
  });
  it('the previous finished check in full, next-time notes first; history in the given (newest first) order with kind words', () => {
    const fin = chk({ id: 'f1', finished: true, heldOn: '2026-09-01', content: { answers: { faith01: { asked: true, note: 'Going well' } }, nextTime: 'Ask about camp' } });
    const note = chk({ id: 'n1', kind: 'note', heldOn: '2026-10-25', content: { text: 'Quick word' } });
    const h = F._icLeaderHtml(leaderData([note, fin]), 'u1');
    const top = h.slice(h.indexOf('Last finished check'), h.indexOf('History'));
    expect(top).toContain('D:2026-09-01');
    expect(top.indexOf('Ask about camp')).toBeLessThan(top.indexOf('Going well'));
    expect(top).toContain('FAITH – their walk with God');
    const hist = h.slice(h.indexOf('History'));
    expect(hist).toContain('D:2026-10-25 · Note');
    expect(hist).not.toContain('D:2026-09-01 · Check'); // the newest finished check shows once, under Last finished check
    expect(top).toContain('class="card rc drop open" id="ic-h-f1"');
    expect(top).toContain('_icDelete(&quot;f1&quot;)');
    expect(hist).toContain('<span class="drop-chev"><i>chevr</i></span>');
    const two = F._icLeaderHtml(leaderData([note, chk({ id: 'f2', finished: true, heldOn: '2026-10-01' }), fin]), 'u1');
    const h2 = two.slice(two.indexOf('History'));
    expect(h2.indexOf('D:2026-10-25 · Note')).toBeLessThan(h2.indexOf('D:2026-09-01 · Check')); // older finished ones stay in History, newest first
    expect(h2).not.toContain('ic-h-f2');
  });
  it('a question ticked with no note reads Asked', () => {
    const fin = chk({ finished: true, content: { answers: { faith01: { asked: true, note: '' } }, nextTime: '' } });
    expect(F._icEntryBody(fin, leaderData([]).questions)).toContain('>Asked<');
  });
});

describe('_icLastTime', () => {
  const ans = (a: any) => ({ answers: { faith01: a }, nextTime: '' });
  it('picks the newest other check where the key was asked or noted, finished or not', () => {
    const es = [
      chk({ id: 'old', heldOn: '2026-01-01', finished: true, content: ans({ asked: false, note: 'old note' }) }),
      chk({ id: 'mid', heldOn: '2026-05-01', finished: false, content: ans({ asked: true, note: '' }) }),
      chk({ id: 'cur', heldOn: '2026-10-01', content: ans({ asked: true, note: 'current' }) }),
    ];
    expect(F._icLastTime(es, 'cur', 'faith01')).toEqual({ on: '2026-05-01', note: '', asked: true });
  });
  it('skips the current entry, notes, and an answer that is neither ticked nor noted; null when none', () => {
    const es = [
      chk({ id: 'cur', heldOn: '2026-10-01', content: ans({ asked: true, note: 'x' }) }),
      chk({ id: 'blank', heldOn: '2026-09-01', content: ans({ asked: false, note: '   ' }) }),
      chk({ id: 'n', kind: 'note', heldOn: '2026-09-15', content: { text: 'faith01' } }),
    ];
    expect(F._icLastTime(es, 'cur', 'faith01')).toBeNull();
    expect(F._icLastTime([], 'cur', 'faith01')).toBeNull();
    es.push(chk({ id: 'ok', heldOn: '2026-08-01', content: ans({ asked: false, note: 'kept' }) }));
    expect(F._icLastTime(es, 'cur', 'faith01')).toEqual({ on: '2026-08-01', note: 'kept', asked: false });
  });
});

describe('_icGet never serves the 30 s cache', () => {
  it('with a primed Cache entry for /id-checks it still calls the network', async () => {
    const start = HTML.indexOf('const Cache = (() => {');
    const Cache = new Function(`${HTML.slice(start, HTML.indexOf('})();', start) + 5)}\nreturn Cache;`)();
    Cache.set('/id-checks', { stale: true });
    const net: string[] = [];
    const API = { get: (p: string) => { const c = Cache.get(p); if (c !== null) return Promise.resolve(c); net.push(p); return Promise.resolve({ fresh: true }); } };
    const f = load({ Cache, API });
    expect(await f._icGet('/id-checks')).toEqual({ fresh: true });
    expect(net).toEqual(['/id-checks']);
  });
});

describe('two-tap Delete', () => {
  it('the first tap arms "Delete for good?", the second deletes and drops the local draft', async () => {
    const btn: any = { dataset: {}, textContent: 'Delete', disabled: false };
    const dels: string[] = [], removed: string[] = [];
    const f = load({
      document: { getElementById: () => btn }, API: { del: (p: string) => { dels.push(p); return Promise.resolve({}); } },
      localStorage: { removeItem: (k: string) => removed.push(k) }, toast: () => {}, renderIdCheckLeader: () => {},
    });
    await f._icDelete('c1');
    expect(btn.textContent).toBe('Delete for good?');
    expect(dels).toEqual([]);
    await f._icDelete('c1');
    expect(dels).toEqual(['/id-checks/entries/c1']);
    expect(removed).toEqual(['ysc.ic.u1.c1']);
  });
});

describe('escaping', () => {
  it('every name in the output goes through esc()', () => {
    const bad = '<b>x</b>';
    const outs = [
      F._icListHtml(list([row({ name: bad })]), false),
      F._icLeaderHtml({ ...leaderData([chk({ authorName: bad, mine: false, authorId: 'u2', content: { answers: { faith01: { asked: true, note: bad } }, nextTime: bad } }), chk({ id: 'n', kind: 'note', content: { text: bad } })]), leader: { id: 'l1', name: bad } }, 'u1'),
    ];
    for (const h of outs) { expect(h).not.toContain(bad); expect(h).toContain('&lt;b&gt;x&lt;/b&gt;'); }
  });
});

describe('Delete waits for an in-flight save', () => {
  it('the delete request goes out only after the flying save settles', async () => {
    const btn: any = { dataset: { armed: '1' }, textContent: '', disabled: false };
    const order: string[] = [];
    const f = load({
      document: { getElementById: () => btn }, API: { del: () => { order.push('del'); return Promise.resolve({}); } },
      localStorage: { removeItem: () => {} }, toast: () => {}, renderIdCheckLeader: () => {},
    });
    f._IC.flying.c1 = new Promise<void>((r) => setTimeout(() => { order.push('save'); r(); }, 20));
    await f._icDelete('c1');
    expect(order).toEqual(['save', 'del']);
  });
});
