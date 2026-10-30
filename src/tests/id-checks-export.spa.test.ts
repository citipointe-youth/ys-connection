// ID Checks Task 16: the per-leader export (.txt and .xlsx), built in the browser from a fresh read.
import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, loadFns, extractFn } from './helpers/extract-fn';
import { ID_CHECK_SECTIONS } from '../core/id-check-questions';

const HTML = loadIndexHtml();
const LEADER = { id: 'l1', name: "Sample O'Dummyton" };
const E = {
  fin: { id: 'e1', leaderId: 'l1', kind: 'check', heldOn: '2026-10-16', finished: true, authorName: 'Oversight One', createdAt: '2026-10-16T01:00:00Z',
    content: { answers: { faith01: { asked: true, note: 'Doing well' }, faith02: { asked: false, note: '' }, form01: { asked: false, note: 'Noted only' } }, nextTime: 'Ask about exams' } },
  prog: { id: 'e2', leaderId: 'l1', kind: 'check', heldOn: '2026-10-23', finished: false, authorName: 'The Admin', createdAt: '2026-10-23T01:00:00Z',
    content: { answers: { faith03: { asked: true, note: '' }, faith99: { asked: true, note: 'Retired question\nsecond line' } }, nextTime: '' } },
  note: { id: 'e3', leaderId: 'l1', kind: 'note', heldOn: '2026-10-20', finished: false, authorName: 'Oversight One', createdAt: '2026-10-20T01:00:00Z', content: { text: 'Random note text' } },
};
const ENTRIES = [E.fin, E.prog, E.note];
const PRELUDE = `var S = { user: { displayName: 'Tom Admin' } };
  function _siteDay() { return '2026-10-30'; } function fmtDay(v) { return 'D:' + v; }
  function _icSectionTitle(sec) { return sec.subtitle ? sec.title + ' – ' + sec.subtitle : sec.title; }`;
const fns = () => loadFns(['_icAnswered', '_icExportSorted', '_icExportText', '_icExportRows'], PRELUDE);

describe('_icExportText', () => {
  const t = fns()._icExportText(LEADER, ENTRIES, ID_CHECK_SECTIONS);
  it('has the header and one block per entry, newest first', () => {
    expect(t.startsWith("ID checks: Sample O'Dummyton\nExported D:2026-10-30 by Tom Admin\n\n")).toBe(true);
    const order = ['== Check, D:2026-10-23, The Admin (In progress) ==', '== Note, D:2026-10-20, Oversight One ==', '== Check, D:2026-10-16, Oversight One (Finished) =='].map(x => t.indexOf(x));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('lists asked questions under the section heading with an en dash, and their notes', () => {
    expect(t).toContain('FAITH – their walk with God');
    expect(t).toContain('- How\'s your relationship with God? [Asked]\n  Doing well');
    expect(t).toContain('- What are you reading in the bible? [Asked]');
  });
  it('counts a note without a tick as asked, and omits unasked questions', () => {
    expect(t).toContain('Noted only');
    expect(t).not.toContain('What does spending time with God look like?');
    expect(t).not.toContain("How's your mind");
  });
  it('prints a key that is not in the bank as the key, with a multi-line note indented', () => {
    expect(t).toContain('- faith99 [Asked]\n  Retired question\n  second line');
  });
  it('prints the next-time text and the note text; no next-time block when empty', () => {
    expect(t).toContain('Notes for next time:\nAsk about exams');
    expect(t).toContain('Random note text');
    expect((t.match(/Notes for next time:/g) || []).length).toBe(1);
  });
});

describe('_icExportRows', () => {
  const rows: any[][] = fns()._icExportRows(LEADER, ENTRIES, ID_CHECK_SECTIONS);
  it('has the exact header', () => {
    expect(rows[0]).toEqual(['Date', 'Kind', 'Status', 'Author', 'Section', 'Question', 'Asked', 'Note']);
  });
  it('has one row per answered question, next-time and note', () => {
    // fin: faith01 + form01 (noted) + next time = 3; prog: faith03 + faith99 = 2; note = 1
    expect(rows.length - 1).toBe(6);
    expect(rows.every(r => r.length === 8)).toBe(true);
  });
  it('fills the columns', () => {
    const r = rows.find(x => x[5] === "How's your relationship with God?")!;
    expect(r).toEqual(['2026-10-16', 'Check', 'Finished', 'Oversight One', 'FAITH', "How's your relationship with God?", 'Yes', 'Doing well']);
    expect(rows.find(x => x[5] === 'Notes for next time')![7]).toBe('Ask about exams');
    expect(rows.find(x => x[1] === 'Note')).toEqual(['2026-10-20', 'Note', '', 'Oversight One', '', '', '', 'Random note text']);
    expect(rows.find(x => x[5] === 'faith99')![2]).toBe('In progress');
  });
});

describe('the sheet and the download', () => {
  const load = (opts: { get: (p: string) => Promise<any>; xlsx?: boolean }) => {
    const calls = { modal: [] as any[], toast: [] as any[], text: [] as any[], write: [] as any[], close: [] as any[], get: [] as any[] };
    const XLSX = { utils: { aoa_to_sheet: (a: any) => ({ aoa: a }), book_new: () => ({ sheets: [] as any[] }), book_append_sheet: (wb: any, ws: any, n: string) => wb.sheets.push([n, ws]) },
      writeFile: (...a: any[]) => calls.write.push(a) };
    Object.assign(globalThis, {
      __icget: (p: string) => { calls.get.push(p); return opts.get(p); },
      __modal: (h: string) => calls.modal.push(h), __toast: (m: string) => calls.toast.push(m), __text: (...a: any[]) => calls.text.push(a), __close: () => calls.close.push(1), __X: XLSX,
    });
    const f = loadFns(['_icExportOpen', '_icExportGo', '_icAnswered', '_icExportSorted', '_icExportText', '_icExportRows'], `${PRELUDE}
      const _ICX = { id: null, sections: null, busy: false };
      const _icGet = globalThis.__icget; const modal = globalThis.__modal; const toast = globalThis.__toast; const closeModal = globalThis.__close;
      const _downloadText = (...a) => globalThis.__text(...a); const _ensureXlsx = async () => {}; const XLSX = globalThis.__X;`, ['_icExportOpen', '_icExportGo']);
    return { f, calls };
  };
  const server = (leader = async () => ({ leader: LEADER, entries: ENTRIES })) => (p: string) =>
    p.startsWith('/id-checks/leaders/') ? leader() : p === '/id-checks' ? Promise.resolve({ questions: ID_CHECK_SECTIONS, leaders: [] }) : Promise.reject(new Error('unexpected ' + p));

  it('the sheet has Text file, Excel file and the keep-safe line', () => {
    const { f, calls } = load({ get: server() });
    f._icExportOpen('l1');
    const h = calls.modal[0];
    expect(h).toContain('Text file');
    expect(h).toContain('Excel file');
    expect(h).toContain('The file holds private notes. Keep it safe and delete it when done.');
    expect(h).toContain("_icExportGo('txt')");
    expect(h).toContain("_icExportGo('xlsx')");
  });
  it('txt: one fresh GET of the leader, then _downloadText once as text/plain with the file name', async () => {
    const { f, calls } = load({ get: server() });
    f._icExportOpen('l1');
    await f._icExportGo('txt');
    expect(calls.get[0]).toBe('/id-checks/leaders/l1');
    expect(calls.text.length).toBe(1);
    expect(calls.text[0][0]).toBe('id-checks-Sample-O-Dummyton-2026-10-30.txt');
    expect(calls.text[0][1]).toContain('ID checks: Sample O\'Dummyton');
    expect(calls.text[0][2]).toBe('text/plain');
    expect(calls.write.length).toBe(0);
    expect(calls.close.length).toBe(1);
  });
  it('xlsx: XLSX.writeFile once, sheet "ID checks"', async () => {
    const { f, calls } = load({ get: server() });
    f._icExportOpen('l1');
    await f._icExportGo('xlsx');
    expect(calls.write.length).toBe(1);
    expect(calls.write[0][1]).toBe('id-checks-Sample-O-Dummyton-2026-10-30.xlsx');
    expect(calls.write[0][0].sheets[0][0]).toBe('ID checks');
    expect(calls.write[0][0].sheets[0][1].aoa[0][0]).toBe('Date');
    expect(calls.text.length).toBe(0);
  });
  it('a removed tick (404) gives a toast and no file of either kind', async () => {
    for (const kind of ['txt', 'xlsx']) {
      const { f, calls } = load({ get: server(async () => { throw Object.assign(new Error('Not found'), { status: 404 }); }) });
      f._icExportOpen('l1');
      await f._icExportGo(kind);
      expect(calls.toast).toEqual(['You no longer have access to this leader.']);
      expect(calls.text.length + calls.write.length).toBe(0);
    }
  });
  it('another failure toasts and makes no file', async () => {
    const { f, calls } = load({ get: server(async () => { throw new Error('boom'); }) });
    f._icExportOpen('l1');
    await f._icExportGo('txt');
    expect(calls.toast).toEqual(['Could not export. Try again.']);
    expect(calls.text.length).toBe(0);
  });
  it('the leader read is always the _icGet path (which drops the Cache entry first)', () => {
    const go = extractFn(HTML, '_icExportGo');
    expect(go).toContain("await _icGet('/id-checks/leaders/'");
    expect(go).not.toMatch(/API.get|Cache.get/);
  });
});

describe('source hygiene', () => {
  const block = HTML.slice(HTML.indexOf('const _ICX ='), HTML.indexOf('/*IC-EXPORT*/'));
  it('is above its marker', () => { expect(block.length).toBeGreaterThan(500); });
  it('has no console call and makes no server call but the GETs', () => {
    expect(block).not.toMatch(/console\./);
    expect(block).not.toMatch(/API\.(post|put|patch|del)|fetch\(/);
  });
});
