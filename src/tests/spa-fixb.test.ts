// Batch B (R1, R10-R18): extract-and-run the REAL functions from public/index.html against small stubs.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const esc = `const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));`;
const C = () => (globalThis as any).__c;

describe('R1 resend flag', () => {
  const run = async (post: () => Promise<any>, outcome: any = null) => {
    const I: any = { debT: null, busy: false, resend: {}, det: { detail: {}, row: { key: 'k1' }, actions: [] }, date: '2026-10-09', keepMem: {} };
    (globalThis as any).__c = { I, post, outcome };
    const f = loadFns(['_ikAnswerSend', '_ikSaveBlock', '_ikTextBlock'], `
      const I = __c.I; const toasts = [];
      const _ik = () => I, _ikAns = () => ({ fixes: {}, keeps: {} }), _ikAnswerBody = () => ({ payload: {}, note: '' }),
        _ikOpenOf = () => null, _lkUuid = () => 'u1', _ikPost = __c.post, _ikOutcome = () => __c.outcome, _ikLocal = () => {},
        toast = (m) => toasts.push(m), _ikDraw = () => {}, _ikSchedule = () => {}, _ikRev = () => 4, _ikOldConsole = () => 'old', _ikTodo = () => [1];`);
    await f._ikAnswerSend(false);
    const list = { takenAt: 1, stale: false };
    return { I, save: f._ikSaveBlock(I.det, list, {}), text: f._ikTextBlock(I.det, list, {}) };
  };
  it('a thrown post sets resend and blocks Save and Text', async () => {
    const r = await run(() => Promise.reject(new Error('net')));
    expect(r.I.resend.k1).toBe(true);
    expect(r.save).toMatch(/Not sent yet/);
    expect(r.text).toMatch(/Not sent yet/);
  });
  it('an unknown outcome without a message sets resend', async () => {
    const r = await run(() => Promise.resolve({}), { outcome: 'error' });
    expect(r.I.resend.k1).toBe(true);
  });
  it('a refusal with a message does not', async () => {
    const r = await run(() => Promise.resolve({}), { outcome: 'refused', message: 'No.' });
    expect(r.I.resend.k1).toBeUndefined();
    expect(r.save).toBe('');
  });
});

describe('R10 no repaint while typing', () => {
  const draw = (active: any) => {
    const el: any = { innerHTML: 'OLD', contains: (x: any) => x === active };
    (globalThis as any).__c = { el, active, I: { pendingDraw: false } };
    const f = loadFns(['_ikDraw'], `const S = { page: 'link-intake' }; const document = { activeElement: __c.active, getElementById: () => __c.el }; const _ik = () => __c.I; const _ikPageHtml = () => 'NEW';`);
    f._ikDraw();
    return C();
  };
  it('a focused select blocks the repaint and flags it', () => {
    const c = draw({ tagName: 'SELECT' });
    expect(c.el.innerHTML).toBe('OLD');
    expect(c.I.pendingDraw).toBe(true);
  });
  it('nothing focused repaints', () => {
    expect(draw({ tagName: 'BODY' }).el.innerHTML).toBe('NEW');
  });
});

describe('R11 error row is a button', () => {
  it('has button + aria-expanded', () => {
    const f = loadFns(['_elRowHtml'], `${esc} const EL_CATS = {}; const _elHelp = () => ({ what: '', todo: '', act: false }); const _elIsNew = () => false; const _laRelTime = () => ''; const _laFmtBrisbane = () => '';`);
    const h = f._elRowHtml({ id: 'a', message: 'm', count: 1, minimised: true, category: 'x' }, 0);
    expect(h).toContain('<button type="button" class="el-top" aria-expanded="false"');
  });
});

describe('R12 same-name blocks both parent fields', () => {
  it('parentFirst and parentLast', () => {
    const f = loadFns(['_nyFieldMsgs'], `const toAuMobile = (x) => x; const tidyName = (x) => String(x).trim();`);
    const m = f._nyFieldMsgs({ firstName: 'Sam', lastName: 'Lee', parentFirst: 'sam', parentLast: 'LEE' });
    expect(m.block.parentFirst).toBeTruthy();
    expect(m.block.parentLast).toBe(m.block.parentFirst);
  });
});

describe('R14 hidden Text card leaves a link', () => {
  it('shows Text the parent when hidden, Not now on the card', () => {
    const f = loadFns(['_ikFamilyHtml', '_ikTextCardHtml'], `${esc}
      const icS = () => '', _ikHead = () => '', _ikMatchHtml = () => '', _ikCompareHtml = () => '', _ikVerdictHtml = () => '', _ikStepsHtml = () => '',
        _ikSaveHtml = () => '', _ikResultHtml = () => '', _ikOpenOf = () => null, _ikAct = () => null, _ikAlone = () => [], _ikTextBlock = () => '',
        _ikShowText = () => ({ sms: { name: 'P', last3: '123' } }), _ikKv = () => '', _ik = () => ({ hideText: 'k' });`);
    const det = { detail: { forms: {} }, row: { key: 'k' }, actions: [] };
    expect(f._ikFamilyHtml(det, {}, {}, { fixes: {}, keeps: {} })).toContain('Text the parent');
    expect(f._ikTextCardHtml({ sms: { name: 'P', last3: '1' } }, { forms: {} }, '')).toContain('Not now');
  });
});

describe('R15 delete-all arm text', () => {
  it('names N and M ignored; ignore toasts', async () => {
    const btn: any = { dataset: {}, textContent: '' };
    (globalThis as any).__c = { btn, toasts: [] as string[] };
    const f = loadFns(['elDeleteAll', 'elFlag'], `
      const document = { getElementById: () => __c.btn }; let _elCat = ''; const toast = (m) => __c.toasts.push(m); const _elPaint = () => {};
      let _elRows = [{ id: 'a', ignored: true }, { id: 'b' }, { id: 'c' }];
      const _elVisible = (rows) => rows; const API = { patch: async () => ({}) };`);
    await f.elDeleteAll();
    expect(btn.textContent).toBe("Tap again to delete 3 (1 ignored). This can't be undone.");
    await f.elFlag('b', { ignored: true });
    expect(C().toasts).toContain('Ignored. Use Show ignored to undo.');
  });
});

describe('R16 R17 R18', () => {
  it('sheet steps are dots (the value-fix sheet is gone: no editable answer cells, 2026-10-14)', () => {
    const f = loadFns(['_ikSheetHtml'], `${esc} const icS = () => 'TICK'; const _ikTagHtml = () => ''; const _ikDTag = () => null;`);
    const h = f._ikSheetHtml('t', [{ text: 'x' }], '', 'Go');
    expect(h).toContain('ik-dot');
    expect(h).not.toContain('lk-box');
  });
  it('Undo keep drops that one keep and sends the answer set again', () => {
    const I: any = { det: { row: { key: 'k' } }, keepMem: { k: { parentPhone: '1' } } };
    const a: any = { keeps: { s: { parentPhone: '1', parentName: 'J' } } };
    (globalThis as any).__c = { I, a, sent: [] as any[] };
    const f = loadFns(['_ikUnkeep'], `const _ik = () => __c.I; const _ikAns = () => __c.a; const _ikStudentSub = () => 's';
      const _ikForm = () => ({ issues: [{ keep: { field: 'parentPhone', value: '1' } }] }); const _ikAnswerSend = (u) => __c.sent.push(u);`);
    f._ikUnkeep(0, 0);
    expect(a.keeps.s).toEqual({ parentName: 'J' });
    expect(I.keepMem.k).toEqual({});
    expect(C().sent).toEqual([false]);
  });
});
