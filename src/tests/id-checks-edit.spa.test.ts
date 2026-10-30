// ID check editor with autosave (Task 14): debounce, draft kept until the server confirms, retry, Finish ordering,
// draft restore only for the same login, logout clearing, "Last time" and retired questions. Fake timers, stubbed API.put.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['esc', '_icJs', '_icDraftDropIf', '_icLetGo', '_icWaitFlying', '_icSectionTitle', '_icLastTime', '_icMine', '_icDraftKey', '_icDraftGet', '_icDraftSave', '_icDraftDrop', '_icEd', '_icAnswered', '_icHasContent',
  '_icNew', '_icEdit', '_icStatusText', '_icEditHtml', 'renderIdCheckEdit', '_icTouch', '_icSet', '_icAns', '_icAsk', '_icNote', '_icSchedule',
  '_icPaint', '_icFlush', '_icFinish', '_icClose', '_icWire', '_icResendDrafts', '_icClearLocal'];
const CONSTS = ['_IC', '_IC_BTN', '_IC_BACKOFF'].map((n) => HTML.match(new RegExp(`^const ${n} = .*$`, 'm'))![0]).join('\n');

const BANK = [{ key: 'faith', title: 'FAITH', subtitle: 'their walk with God', questions: [{ key: 'faith01', text: 'How is it going?' }, { key: 'faith02', text: 'Old question', retired: true }] }];

type Put = { path: string; body: any; resolve: (v?: any) => void; reject: (e: any) => void };
function setup(user = 'u1', store = new Map<string, string>()) {
  const puts: Put[] = [];
  const pages: string[] = [], toasts: string[] = [];
  let html = '';
  const status: any = { textContent: '' };
  const env: Record<string, any> = {
    S: { user: { id: user, role: 'oversight' } },
    fmtDay: (v: string) => 'D:' + v, _siteDay: () => '2026-10-30', _siteHHMM: () => '14:14', icS: () => '', _lkUuid: () => 'e1',
    shell: (x: string) => x, setApp: (x: string) => { html = x; }, go: (p: string) => pages.push(p), navBack: () => pages.push('back'),
    toast: (m: string) => toasts.push(m), _here: () => ({}), _still: () => true,
    document: { getElementById: (id: string) => (id === 'ic-status' ? status : null), addEventListener: () => {} },
    window: { addEventListener: () => {} },
    localStorage: {
      get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
    },
    API: { put: (path: string, body: any) => new Promise((resolve, reject) => puts.push({ path, body: JSON.parse(JSON.stringify(body)), resolve, reject })) },
  };
  const src = FNS.map((n) => extractFn(HTML, n)).join('\n');
  const f = new Function('__env', `with (__env) { ${CONSTS}\n${src}\n return { _IC, ${FNS.join(', ')} }; }`)(env) as Record<string, any>;
  f._IC.uid = user; f._IC.leaderId = 'l1';
  f._IC.data = { questions: BANK };
  f._IC.leader = { leader: { id: 'l1', name: 'Sample Dummyton' }, entries: [] };
  return { f, env, puts, pages, toasts, store, status, html: () => html };
}
const ok = { updatedAt: '2026-10-30T04:14:00Z', finished: false };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('autosave', () => {
  it('one PUT 1.5 s after the last keystroke, always finished:false', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icNote('faith01', 'h');
    await vi.advanceTimersByTimeAsync(500);
    t.f._icNote('faith01', 'he');
    await vi.advanceTimersByTimeAsync(500);
    t.f._icNote('faith01', 'hello');
    await vi.advanceTimersByTimeAsync(1499);
    expect(t.puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.puts).toHaveLength(1);
    expect(t.puts[0]!.path).toBe('/id-checks/entries/e1');
    expect(t.puts[0]!.body).toMatchObject({ leaderId: 'l1', kind: 'check', heldOn: '2026-10-30', finished: false });
    expect(t.puts[0]!.body.content.answers.faith01).toEqual({ asked: true, note: 'hello' }); // a note counts as asked
  });
  it('the draft is on the phone before the reply and gone after a 2xx; the status says Saved', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'camp');
    expect(JSON.parse(t.store.get('ysc.ic.u1.e1')!)).toMatchObject({ uid: 'u1', leaderId: 'l1', content: { nextTime: 'camp' } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.store.has('ysc.ic.u1.e1')).toBe(true);
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.store.has('ysc.ic.u1.e1')).toBe(false);
    expect(t.status.textContent).toBe('Saved 2:14pm');
  });
  it('a change typed while the PUT is out keeps the draft (it holds newer text) and sends again', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'a');
    await vi.advanceTimersByTimeAsync(1500);
    t.f._icSet('nextTime', 'ab');
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(t.store.get('ysc.ic.u1.e1')!).content.nextTime).toBe('ab');
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.puts).toHaveLength(2);
    expect(t.puts[1]!.body.content.nextTime).toBe('ab');
  });
  it('a 503 keeps the draft, shows "Not saved, retrying" and retries after 2 s, 5 s, 15 s, then 30 s', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'x');
    await vi.advanceTimersByTimeAsync(1500);
    for (const [i, wait] of [[0, 2000], [1, 5000], [2, 15000], [3, 30000], [4, 30000]] as const) {
      t.puts[i]!.reject(Object.assign(new Error('busy'), { status: 503 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.status.textContent).toBe('Not saved, retrying');
      expect(t.store.has('ysc.ic.u1.e1')).toBe(true);
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(t.puts, `before retry ${i + 1}`).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.puts, `retry ${i + 1}`).toHaveLength(i + 2);
    }
  });
  it('a refused save (400) is not retried and says Not saved', async () => {
    const t = setup();
    t.f._icNew('note');
    t.f._icSet('text', 'x');
    await vi.advanceTimersByTimeAsync(1500);
    t.puts[0]!.reject(Object.assign(new Error('Too long'), { status: 400 }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.puts).toHaveLength(1);
    expect(t.status.textContent).toBe('Not saved: Too long');
  });
});

describe('Finish check', () => {
  it('sends the pending save first, then finished:true, then the leader page; no later PUT carries finished:false', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icNote('faith01', 'note');
    const ed = t.f._IC.ed;
    const done = t.f._icFinish();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.puts.map((p) => p.body.finished)).toEqual([false]);
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.puts.map((p) => p.body.finished)).toEqual([false, true]);
    t.f._icNote('faith01', 'typed during finish'); // ignored by the server path: no autosave is scheduled while finishing
    t.puts[1]!.resolve({ ...ok, finished: true });
    await done;
    expect(t.pages).toEqual(['idcheck-edit', 'idcheck-leader']);
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts.slice(1).every((p) => p.body.finished === true)).toBe(true);
    expect(t.puts).toHaveLength(2);
    // even a flush that slips through (a leave-the-app event) sends nothing for a finished-here check
    ed.ver++;
    expect(await t.f._icFlush(ed)).toBe(true);
    expect(t.puts).toHaveLength(2);
    expect(t.store.get('ysc.ic.u1.e1')).toContain('typed during finish'); // the late text is kept on the phone, not lost
  });
  it('a pending retry is cleared by Finish', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'x');
    await vi.advanceTimersByTimeAsync(1500);
    t.puts[0]!.reject(Object.assign(new Error('busy'), { status: 503 }));
    await vi.advanceTimersByTimeAsync(0);
    const done = t.f._icFinish();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[1]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    t.puts[2]!.resolve({ ...ok, finished: true });
    await done;
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts.map((p) => p.body.finished)).toEqual([false, false, true]);
    expect(t.store.size).toBe(0);
  });
  it('a failed save stops Finish: no finished:true is sent', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'x');
    const done = t.f._icFinish();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[0]!.reject(Object.assign(new Error('offline'), {}));
    await done;
    expect(t.puts.map((p) => p.body.finished)).toEqual([false]);
    expect(t.pages).toEqual(['idcheck-edit']);
    expect(t.toasts[0]).toMatch(/not finished/);
  });
  it('an untouched check cannot be finished: no PUT, a toast, and the button starts disabled', async () => {
    const t = setup();
    t.f._icNew('check');
    await t.f._icFinish();
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts).toHaveLength(0);
    expect(t.pages).toEqual(['idcheck-edit']);
    expect(t.toasts[0]).toMatch(/at least one question/);
    expect(t.f._icHasContent({ answers: { a: { asked: false, note: ' ' } }, nextTime: '' })).toBe(false);
    expect(t.f._icHasContent({ answers: {}, nextTime: 'x' })).toBe(true);
    expect(t.f._icHasContent({ answers: { a: { asked: true, note: '' } } })).toBe(true);
  });
  it('re-editing a finished check never sends finished:true again', async () => {
    const t = setup();
    t.f._IC.leader.entries = [entry({ finished: true, content: { answers: { faith01: { asked: true, note: 'n' } }, nextTime: '' } })];
    t.f._icEdit('e1');
    await t.f._icFinish();
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts).toHaveLength(0);
  });
  it('Save and close saves then goes back, leaving the check in progress', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'x');
    const done = t.f._icClose();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[0]!.resolve(ok);
    await done;
    expect(t.puts.map((p) => p.body.finished)).toEqual([false]);
    expect(t.pages).toEqual(['idcheck-edit', 'back']);
  });
});

const entry = (o: Record<string, any> = {}) => ({ id: 'e1', leaderId: 'l1', kind: 'check', heldOn: '2026-10-20', finished: false, authorId: 'u1', authorName: 'Ova Sight', mine: true, content: { answers: {}, nextTime: '' }, updatedAt: '2026-10-29T00:00:00Z', ...o });

describe('drafts on reopen', () => {
  it('a draft newer than the server copy is restored and re-sent', async () => {
    const store = new Map([['ysc.ic.u1.e1', JSON.stringify({ uid: 'u1', leaderId: 'l1', kind: 'check', at: '2026-10-30T00:00:00Z', heldOn: '2026-10-20', content: { answers: { faith01: { asked: true, note: 'unsent words' } }, nextTime: '' } })]]);
    const t = setup('u1', store);
    t.f._IC.leader.entries = [entry()];
    t.f._icEdit('e1');
    t.f.renderIdCheckEdit();
    expect(t.html()).toContain('unsent words');
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.puts[0]!.body.content.answers.faith01.note).toBe('unsent words');
  });
  it('an older draft than the server copy is ignored and removed', () => {
    const store = new Map([['ysc.ic.u1.e1', JSON.stringify({ uid: 'u1', at: '2026-10-01T00:00:00Z', heldOn: '2026-10-20', content: { answers: {}, nextTime: 'stale' } })]]);
    const t = setup('u1', store);
    t.f._IC.leader.entries = [entry({ content: { answers: {}, nextTime: 'server' } })];
    t.f._icEdit('e1');
    expect(t.f._IC.ed.content.nextTime).toBe('server');
    expect(store.has('ysc.ic.u1.e1')).toBe(false);
  });
  it('a draft stored by another login never restores, even under this login key', () => {
    const val = JSON.stringify({ uid: 'u2', at: '2026-10-30T00:00:00Z', heldOn: '2026-10-20', content: { answers: {}, nextTime: 'someone else' } });
    const t = setup('u1', new Map([['ysc.ic.u1.e1', val], ['ysc.ic.u2.e1', val]]));
    t.f._IC.leader.entries = [entry()];
    t.f._icEdit('e1');
    expect(t.f._IC.ed.content.nextTime).toBe('');
  });
  it('the draft key carries the login id', () => {
    expect(setup('u7').f._icDraftKey('abc')).toBe('ysc.ic.u7.abc');
  });
  it('logout removes every ysc.ic. key', () => {
    const t = setup('u1', new Map([['ysc.ic.u1.e1', '{}'], ['ysc.ic.u2.e9', '{}'], ['ysc.lkq.u1', '[]']]));
    t.f._icClearLocal();
    expect([...t.store.keys()]).toEqual(['ysc.lkq.u1']);
  });
  it('a pending save never goes out under another login', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'mine');
    t.env.S.user = { id: 'u2', role: 'oversight' };
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.puts).toHaveLength(0);
  });
  it('leader page load: an orphan draft is sent once, a covered or foreign one removed, a refused one removed', async () => {
    const d = (o: any) => JSON.stringify({ uid: 'u1', leaderId: 'l1', kind: 'note', at: '2026-10-30T00:00:00Z', heldOn: '2026-10-29', content: { text: 'x' }, tok: 't:3', ...o });
    const store = new Map([
      ['ysc.ic.u1.e9', d({ content: { text: 'offline note' } })],
      ['ysc.ic.u1.e8', d({ leaderId: 'other' })],
      ['ysc.ic.u1.e7', d({ at: '2026-10-01T00:00:00Z' })], // the server copy is newer
      ['ysc.ic.u1.e6', d({})], // someone else's entry
      ['ysc.ic.u1.e5', d({})], // the server refuses it
    ]);
    const t = setup('u1', store);
    const entries = [entry({ id: 'e7', updatedAt: '2026-10-29T00:00:00Z' }), entry({ id: 'e6', mine: false, authorId: 'u2' })];
    const n = t.f._icResendDrafts('l1', entries);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.puts.map((p) => p.path)).toEqual(['/id-checks/entries/e9']);
    expect(t.puts[0]!.body).toMatchObject({ leaderId: 'l1', kind: 'note', finished: false, content: { text: 'offline note' } });
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    t.puts[1]!.reject(Object.assign(new Error('bad'), { status: 400 }));
    expect(await n).toBe(1);
    expect([...store.keys()].sort()).toEqual(['ysc.ic.u1.e8']);
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts).toHaveLength(2); // no retry loop from the leader page
  });
  it('a 503 on a leader-page resend keeps the draft and does not loop', async () => {
    const store = new Map([['ysc.ic.u1.e9', JSON.stringify({ uid: 'u1', leaderId: 'l1', kind: 'note', at: '2026-10-30T00:00:00Z', heldOn: '2026-10-29', content: { text: 'n' }, tok: 't:1' })]]);
    const t = setup('u1', store);
    const n = t.f._icResendDrafts('l1', []);
    await vi.advanceTimersByTimeAsync(0);
    t.puts[0]!.reject(Object.assign(new Error('busy'), { status: 503 }));
    expect(await n).toBe(0);
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.puts).toHaveLength(1);
    expect(store.has('ysc.ic.u1.e9')).toBe(true);
  });
});

describe('reopening an entry (review Important 1)', () => {
  const contentOf = (p: Put) => p.body.content.nextTime;
  it('offline save, Save and close, Resume, type, Finish: the old editor never sends again and the newest text wins', async () => {
    const t = setup();
    t.f._IC.leader.entries = [entry({ updatedAt: '2026-10-29T00:00:00Z' })];
    t.f._icEdit('e1');
    t.f._icSet('nextTime', 'old');
    await vi.advanceTimersByTimeAsync(1500);
    t.puts[0]!.reject(Object.assign(new Error('offline'), {}));
    await vi.advanceTimersByTimeAsync(0);
    const close = t.f._icClose();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[1]!.reject(Object.assign(new Error('offline'), {}));
    await close;
    t.f._icLetGo(); // the leader page renders after Save and close
    t.f._icEdit('e1'); // Resume: the draft ("old") is newer than the server copy
    expect(t.f._IC.ed.content.nextTime).toBe('old');
    t.f._icSet('nextTime', 'old and new');
    const fin = t.f._icFinish();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[2]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    t.puts[3]!.resolve({ ...ok, finished: true });
    await fin;
    await vi.advanceTimersByTimeAsync(300000); // well past every back-off of the first editor
    expect(t.puts.map((p) => [contentOf(p), p.body.finished])).toEqual([['old', false], ['old', false], ['old and new', false], ['old and new', true]]);
    expect(t.store.has('ysc.ic.u1.e1')).toBe(false);
  });
  it('an old editor whose PUT lands after the reopen does not remove the newer draft, and the newer body is sent after it', async () => {
    const t = setup();
    t.f._IC.leader.entries = [entry({ updatedAt: '2026-10-29T00:00:00Z' })];
    t.f._icEdit('e1');
    t.f._icSet('nextTime', 'old');
    await vi.advanceTimersByTimeAsync(1500); // PUT 0 ("old") is out, no reply yet
    t.f._icLetGo();
    t.f._icEdit('e1');
    t.f._icSet('nextTime', 'newer');
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.puts).toHaveLength(1); // the new editor waits for the old PUT of the same entry
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(t.store.get('ysc.ic.u1.e1')!).content.nextTime).toBe('newer'); // not removed by the old success
    expect(t.puts.map(contentOf)).toEqual(['old', 'newer']);
    t.puts[1]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.store.has('ysc.ic.u1.e1')).toBe(false);
  });
  it('a leave-the-app flush during the Finish PUT waits for it and sends nothing', async () => {
    const t = setup();
    t.f._icNew('check');
    t.f._icSet('nextTime', 'x');
    const ed = t.f._IC.ed;
    const fin = t.f._icFinish();
    await vi.advanceTimersByTimeAsync(0);
    t.puts[0]!.resolve(ok);
    await vi.advanceTimersByTimeAsync(0); // the Finish PUT is out
    t.f._icSet('nextTime', 'typed during finish');
    const leave = t.f._icFlush(ed, true);
    t.puts[1]!.resolve({ ...ok, finished: true });
    await fin;
    expect(await leave).toBe(true);
    expect(t.puts.map((p) => p.body.finished)).toEqual([false, true]);
  });
  });

describe('editor page', () => {
  const st = (o: Record<string, any> = {}) => ({ id: 'cur', kind: 'check', heldOn: '2026-10-30', isNew: true, status: '', leaderName: 'Sample Dummyton', questions: BANK, entries: [], content: { answers: {}, nextTime: '' }, ...o });
  it('shows "Last time (date): note" for a question noted in an earlier check, "Asked" for a bare tick', () => {
    const t = setup();
    const prev = entry({ id: 'p1', heldOn: '2026-09-01', finished: true, content: { answers: { faith01: { asked: true, note: 'prev note' } }, nextTime: '' } });
    expect(t.f._icEditHtml(st({ entries: [prev] }))).toContain('Last time (D:2026-09-01): prev note');
    const tick = entry({ id: 'p2', heldOn: '2026-09-02', content: { answers: { faith01: { asked: true, note: '' } }, nextTime: '' } });
    expect(t.f._icEditHtml(st({ entries: [tick] }))).toContain('Last time (D:2026-09-02): Asked');
    expect(t.f._icEditHtml(st())).not.toContain('Last time');
  });
  it('a retired question is hidden on a new check and shown on an old check that answered it', () => {
    const t = setup();
    expect(t.f._icEditHtml(st())).not.toContain('Old question');
    expect(t.f._icEditHtml(st({ isNew: false }))).not.toContain('Old question');
    expect(t.f._icEditHtml(st({ isNew: false, content: { answers: { faith02: { asked: true, note: '' } }, nextTime: '' } }))).toContain('Old question');
  });
  it('date, section title, 44px Asked tick, next-time box and both end buttons; note mode has one box and Done', () => {
    const t = setup();
    const h = t.f._icEditHtml(st());
    expect(h).toMatch(/type="date"[^>]*value="2026-10-30"/);
    expect(h).toContain('FAITH – their walk with God');
    expect(h).toMatch(/min-height:44px;min-width:44px[^>]*><input type="checkbox" id="ic-a-faith01"/);
    expect(h).toContain('Notes for next time');
    expect(h).toContain('>Finish check<');
    expect(h).toContain('>Save and close<');
    const n = t.f._icEditHtml(st({ kind: 'note', content: { text: '' } }));
    expect(n).toContain('>Done<');
    expect(n).not.toContain('Finish check');
    expect(n.match(/<textarea/g)).toHaveLength(1);
  });
  it('Finish is disabled until something is asked or noted, and gone on a finished check', () => {
    const t = setup();
    expect(t.f._icEditHtml(st())).toMatch(/id="ic-finish"[^>]*disabled>Finish check</);
    expect(t.f._icEditHtml(st({ content: { answers: { faith01: { asked: true, note: '' } }, nextTime: '' } }))).toContain('onclick="_icFinish(this)">Finish check<');
    const fin = t.f._icEditHtml(st({ isNew: false, finished: true, content: { answers: { faith01: { asked: true, note: '' } }, nextTime: '' } }));
    expect(fin).not.toContain('Finish check');
    expect(fin).toContain('>Save and close<');
  });
  it('a question with an earlier answer shows a Last time marker and every question row a chevron', () => {
    const t = setup();
    const prev = entry({ id: 'p1', heldOn: '2026-09-01', finished: true, content: { answers: { faith01: { asked: true, note: 'prev note' } }, nextTime: '' } });
    expect(t.f._icEditHtml(st({ entries: [prev] }))).toContain('<span class="pill neutral">Last time</span>');
    expect(t.f._icEditHtml(st())).not.toContain('pill neutral');
  });
  it('escapes the leader name and typed text', () => {
    const t = setup();
    const h = t.f._icEditHtml(st({ leaderName: '<b>x</b>', content: { answers: { faith01: { asked: true, note: '<b>x</b>' } }, nextTime: '<b>x</b>' } }));
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
