// QA lane C: a re-tap while the first door tap is still being sent must not undo it (slow signal). Real door functions,
// stubbed API.post, fake timers.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const P = 'p1', SVC = 's1';
function setup(post: (p?: string, b?: any) => Promise<any>, onLine = true) {
  const prelude = `
    const S = { user: { id: 'u1', role: 'grade' }, page: 'link-checkin' };
    const LINK = { svc: '${SVC}', refusals: {}, services: [], fails: 0, flushing: null, timer: null, inflight: {}, toast: null, gmOpen: {}, mres: {}, status: null, loadGen: 0,
      people: { '${SVC}': { people: [{ personId: '${P}', name: 'Ava Sample', grade: 7, checkedIn: false, action: null, mine: false }], leaders: [] } } };
    let Q = [];
    const LK_FLOW_TYPES = [], LK_MEM_TYPES = [];
    const navigator = { userAgent: 'x', onLine: ${onLine} };
    const API = { post: (...a) => globalThis.__post(...a) };
    function _lkQGet() { return Q.slice(); }
    function _lkQSet(q) { Q = q.slice(); }
    function _lkSvc() { return { serviceTimeId: '${SVC}', serviceId: 'sv', ymd: '2026-11-02' }; }
    function _lkUuid() { return 'id-' + (++globalThis.__n.n); }
    function _lkRefreshView() {} function _lkTapToast() {} function toast() {} function _lkMembersLoad() {}
    function getMyLeaderId() { return null; } function _deviceId() { return 'd'; } function _deviceLabel() { return 'l'; }
    function _gradeWord() { return 'Grade'; } function _lkCapOff() { return false; } function _lkLastSeen() { return ''; } function _lkOutsideWindow() { return false; } function _lkSvcDay() { return '2026-11-02'; }
    function esc(s) { return String(s); } function icS() { return ''; }
    function row() { return _lkRowHtml(_lkMerge(LINK.people['${SVC}'].people, Q, '${SVC}')[0]); }
    function saved() { return LINK.people['${SVC}'].people[0]; }
  `;
  const names = ['_lkCheck', '_lkUndo', '_lkPush', '_lkSchedule', '_lkTakeBack', '_lkQueuedIdx', '_lkMerge', '_lkApply', '_lkFlush', '_lkFailed', '_lkResults',
    '_lkRowHtml', '_lkStatusTone', '_lkStatusText', '_lkStatusHtml'];
  (globalThis as any).__post = post; (globalThis as any).__n = { n: 0 };
  return loadFns(names, prelude, ['_lkCheck', '_lkUndo', '_lkQGet', 'row', 'saved']);
}
const savedAnswer = (b: any) => ({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved', mine: true, action: { id: i.id, type: i.type, status: 'pending', reason: null } })) });

afterEach(() => { vi.useRealTimers(); });

describe('door re-tap while the first tap is being sent', () => {
  it('a re-tap is ignored while pending, the row shows Saving…; once saved a deliberate Undo reuses the id', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const f = setup((_p?: string, b?: any) => new Promise((res) => { release = () => res(savedAnswer(b)); }));
    f._lkCheck(P, 'checkIn');
    const id = f._lkQGet()[0].id;
    await vi.advanceTimersByTimeAsync(2000); // on the wire, the 600 ms hold is long over
    expect(f.row()).toContain('Saving…');
    expect(f.row()).toContain('aria-disabled="true"');
    f._lkCheck(P, 'checkIn'); // the row
    f._lkUndo(P); // its Undo button
    expect(f._lkQGet().map((i: any) => i.id)).toEqual([id]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f._lkQGet()).toEqual([]);
    expect(f.saved()).toMatchObject({ checkedIn: true, action: { id, status: 'pending' } });
    expect(f.row()).not.toContain('aria-disabled');
    f._lkUndo(P);
    expect(f._lkQGet()[0]).toMatchObject({ kind: 'undo', id });
  });
  it('offline: a queued tap is settled at once, says Waiting to send, and Undo removes it', async () => {
    vi.useFakeTimers();
    const f = setup(() => Promise.reject(new Error('offline')), false);
    f._lkCheck(P, 'checkIn');
    expect(f.row()).toContain('Waiting to send.');
    expect(f.row()).not.toContain('aria-disabled');
    await vi.advanceTimersByTimeAsync(700);
    f._lkUndo(P);
    expect(f._lkQGet()).toEqual([]);
  });
  it('a failed send settles the tap (online flag lies), and Undo removes it', async () => {
    vi.useFakeTimers();
    const f = setup(() => Promise.reject(new Error('dead wifi')));
    f._lkCheck(P, 'checkIn');
    await vi.advanceTimersByTimeAsync(700);
    expect(f.row()).toContain('Waiting to send.');
    f._lkUndo(P);
    expect(f._lkQGet()).toEqual([]);
  });
  it('a request that never answers locks the row for 25 s at most; then Undo queues an undo after it', async () => {
    vi.useFakeTimers();
    const f = setup(() => new Promise(() => {}));
    f._lkCheck(P, 'checkIn');
    const id = f._lkQGet()[0].id;
    await vi.advanceTimersByTimeAsync(24000);
    f._lkUndo(P);
    expect(f._lkQGet()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.row()).not.toContain('aria-disabled');
    f._lkUndo(P);
    expect(f._lkQGet().map((i: any) => i.kind)).toEqual(['action', 'undo']);
    expect(f._lkQGet()[1]).toMatchObject({ id, _p: P });
  });
});
