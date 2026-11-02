import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

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

describe('#25 New Year re-import reports', () => {
  const load = () => {
    let shown = '';
    (globalThis as any).__m = (h: string) => { shown = h; };
    const f: Record<string, any> = loadFns(['showAllocationReport', 'showPrayerImportReport'], "function modal(h) { globalThis.__m(h); } function esc(s) { return s; } function icS() { return ''; }");
    return { ...f, html: () => shown } as Record<string, any>;
  };
  const alloc = { studentsInFile: 0, rowsRead: 0, connectionsAdded: 0, connectionsRemoved: 0, connectionsUnchanged: 0, unmatchedStudents: [], unmatchedLeaders: [], ambiguousStudents: [], ambiguousLeaders: [], studentsWithSkippedRemovals: [] };
  it('allocations: 0 students or a dropped row is not clean; a real file is', () => {
    const f = load();
    f.showAllocationReport(alloc, 2);
    expect(f.html()).not.toContain('matched cleanly');
    expect(f.html()).toContain('2 rows had no student name');
    f.showAllocationReport({ ...alloc, studentsInFile: 1, rowsRead: 1 }, 1);
    expect(f.html()).toContain('matched cleanly');
  });
  it('prayers: a row with no text is not clean', () => {
    const f = load();
    f.showPrayerImportReport({ rowsInFile: 1, added: 0, skippedDuplicates: 0, skippedBlank: 1, unmatched: [], ambiguous: [] });
    expect(f.html()).not.toContain('matched cleanly');
    expect(f.html()).toContain('no prayer text');
  });
});

describe('BRK-24 CSV rows', () => {
  it('a line break inside a quoted name stays in one row', () => {
    const { _csvLines, splitCSVLine } = loadFns(['_csvLines', 'splitCSVLine']);
    const lines = _csvLines('First Name,Last Name\r\n"Mary\r\nJane",Lee\r\nBen,Roe\r\n');
    expect(lines).toHaveLength(3);
    expect(splitCSVLine(lines[1])).toEqual(['Mary Jane', 'Lee']);
  });
  it('the preview counts students as the server will', async () => {
    let shown = '';
    (globalThis as any).__m = (h: string) => { shown = h; };
    const { previewServiceImport } = loadFns(['previewServiceImport'], `function modal(h) { globalThis.__m(h); } function esc(s) { return s; }
      const Cache = { get: () => [{ firstName: 'Old', lastName: 'One' }] }; function _gradeList() { return [7, 8, 9]; } function _gradeWord() { return 'Grade'; } const window = {};`);
    await previewServiceImport('f.csv', [
      { first_name: 'Old', last_name: 'One', gender: 'f', grade: 8 },
      { first_name: 'New', last_name: 'Kid', gender: 'f', grade: 8 },
      { first_name: 'New', last_name: 'Kid', gender: 'f', grade: 8 },
      { first_name: 'No', last_name: '', gender: 'f', grade: 8 },
      { first_name: 'Too', last_name: 'Old', gender: 'f', grade: 40 },
    ]);
    expect(shown).toContain('<strong>1</strong> new student · 1 already known');
    expect(shown).toContain('2 rows will be skipped');
  });
  const csvFns = () => {
    const src = loadIndexHtml();
    return loadFns(['parseCSV', '_csvLines', 'splitCSVLine', '_extractHeaderDate'], src.match(/^const _CSV_FIELD_MAP = \{[\s\S]*?^\};/m)![0] + src.match(/^const _CSV_SKIP = .*$/m)![0]);
  };
  it('a stray quote inside a cell keeps every row and every column', () => {
    const csv = 'First Name,Last Name,Gender,2026-02-01\n"Ann","O"Neil","F","Y"\n"Ben","Roe","M","Y"\n"Cal","Poe","M","N"\n"Dee","Lee","F","Y"\n';
    const rows = csvFns().parseCSV(csv);
    expect(rows.map((r: any) => r.first_name)).toEqual(['Ann', 'Ben', 'Cal', 'Dee']);
    expect(rows[0].gender).toBe('F');
    expect(rows[0]['2026-02-01']).toBe(true);
    expect(rows[0].last_name).toContain('Neil');
  });
  it('a quote that opens a cell and never closes keeps every row', () => {
    const { _csvLines, splitCSVLine } = csvFns();
    const lines = _csvLines('First,Last\nAnn,"Neil\nBen,Roe\nCal,Poe');
    expect(lines).toHaveLength(4);
    expect(splitCSVLine(lines[1])).toEqual(['Ann', '"Neil']);
  });
  it('escaped quotes and quoted line breaks and commas still parse', () => {
    const { _csvLines, splitCSVLine } = csvFns();
    const lines = _csvLines('First,Last\r\n"An ""Annie"" Lee","Roe, Jr"\r\n"Mary\nJane",Lee\r\nBen,Roe');
    expect(lines).toHaveLength(4);
    expect(splitCSVLine(lines[1])).toEqual(['An "Annie" Lee', 'Roe, Jr']);
    expect(splitCSVLine(lines[2])).toEqual(['Mary Jane', 'Lee']);
    expect(splitCSVLine(lines[3])).toEqual(['Ben', 'Roe']);
  });
  describe('the confirm step says it replaces saved attendance', () => {
    const preview = async (saved: unknown, count: number) => {
      let shown = '';
      (globalThis as any).__m = (h: string) => { shown = h; };
      (globalThis as any).__saved = saved;
      const { previewServiceImport } = loadFns(['previewServiceImport'], `function modal(h) { globalThis.__m(h); } function esc(s) { return s; }
        const Cache = { get: () => null, getStale: () => null }; const API = { get: async () => { if (!globalThis.__saved) throw new Error('offline'); return globalThis.__saved; } };
        function _gradeList() { return [7, 8, 9]; } function _gradeWord() { return 'Grade'; } const window = {};`);
      await previewServiceImport('f.csv', Array.from({ length: count }, (_, i) => ({ first_name: 'S' + i, last_name: 'Dummyton', gender: 'f', grade: 8 })));
      return shown;
    };
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ firstName: 'S' + i, lastName: 'Dummyton' }));
    const WARN = 'Far fewer students than are saved';
    it('a small file: names both counts and warns, but can still be imported', async () => {
      const h = await preview(list(120), 2);
      expect(h).toContain('This replaces all saved attendance: 120 students now, 2 in this file.');
      expect(h).toContain(WARN);
      expect(h).toContain('uploadServiceImport');
    });
    it('half or more of the saved count: the same plain line, no warning', async () => {
      for (const n of [60, 118]) {
        const h = await preview(list(120), n);
        expect(h).toContain(`This replaces all saved attendance: 120 students now, ${n} in this file.`);
        expect(h).not.toContain(WARN);
      }
    });
    it('one under half warns', async () => {
      expect(await preview(list(120), 59)).toContain(WARN);
    });
    it('saved count unreadable: no invented zero and no warning', async () => {
      const h = await preview(null, 1);
      expect(h).toContain('This replaces all saved attendance. 1 student in this file.');
      expect(h).not.toContain('0 students now');
      expect(h).not.toContain(WARN);
    });
  });
});
