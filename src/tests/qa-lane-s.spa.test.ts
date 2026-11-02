import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

describe('#19 Terminology labels cannot carry markup', () => {
  const world = (service: string) => `const DEFAULT_LABELS = { service: 'Youth' };
    const S = { settings: { ministryConfig: { labels: { service: ${JSON.stringify(service)} }, structure: { gradeLabel: ${JSON.stringify(service)} } } } };
    function _structure() { return S.settings.ministryConfig.structure; }`;
  it('a stored script label renders with no tag, keeps plain words and apostrophes', () => {
    const bad = loadFns(['L', '_gradeWord'], world('<img src=x onerror=__xss=1>'));
    expect(bad.L('service')).not.toMatch(/[<>"]/);
    expect(bad._gradeWord()).not.toMatch(/[<>"]/);
    expect(loadFns(['L'], world("Kids' & Youth")).L('service')).toBe("Kids' & Youth");
    expect(loadFns(['L'], world('<>')).L('service')).toBe('Youth');
  });
});

describe('#3 shared save guard', () => {
  const load = () => loadFns(['_once', '_reqId'], `const _inFlight = new Set(); let __n = 0; function _lkUuid() { return 'id' + (++__n); }`);
  it('a second press while saving does nothing, and a later press works', async () => {
    const { _once } = load();
    let runs = 0, release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const first = _once('k', async () => { runs++; await gate; return 'done'; });
    expect(await _once('k', async () => { runs++; })).toBeUndefined();
    release();
    expect(await first).toBe('done');
    await _once('k', async () => { runs++; });
    expect(runs).toBe(2);
  });
  it('a retry of the same content keeps its requestId; changed content gets a new one', () => {
    const { _reqId } = load();
    const btn = {};
    const id = _reqId(btn, ['Amy']);
    expect(_reqId(btn, ['Amy'])).toBe(id);
    expect(_reqId(btn, ['Amy B'])).not.toBe(id);
  });
});

describe('#20 #21 Undo after removing a leader', () => {
  it('sends gender null and the removed id, then reconnects the students', async () => {
    const posts: [string, any][] = [];
    let undo: () => Promise<void> = async () => {};
    const { doDelLeader } = loadFns(['doDelLeader'], `
      const _aS = { allocs: { s1: ['L1'], s2: ['L2'] } };
      const Cache = { del() {} }; function closeModal() {} function renderConnect() {} function toast() {}
      function showUndoToast(_m, fn) { __setUndo(fn); }
      const API = { get: async () => ({ id: 'L1', fullName: 'Any Gender', gender: null, grades: [8], smsTemplate: null }), del: async () => {},
        post: async (p, b) => { __post(p, b); return { id: b.requestId }; } };`
      .replace('__setUndo', '(globalThis.__u)').replace('__post', '(globalThis.__p)'));
    (globalThis as any).__u = (f: any) => { undo = f; };
    (globalThis as any).__p = (p: string, b: any) => { posts.push([p, b]); };
    await doDelLeader('L1');
    await undo();
    expect(posts[0]![1]).toMatchObject({ requestId: 'L1', gender: null, fullName: 'Any Gender' });
    expect(posts[1]).toEqual(['/connections', { studentId: 's1', leaderId: 'L1' }]);
    expect(posts).toHaveLength(2);
  });
});
