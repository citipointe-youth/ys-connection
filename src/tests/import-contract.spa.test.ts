// r22 A8: the console's Friday import drives the YS Import screen with Playwright (console src/ys-connection.js).
// It clicks the desk-nav <a> "Import", waits for #csv-file, clicks the "Import" confirm button and scrapes
// "Import complete: ..." / "View import report (N item". This pins every one of those, so an Import-screen tidy
// can't break Friday. If this fails, change the console in the same release first.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();

function loadImportBody(user: Record<string, unknown> = { role: 'admin' }, page = 'import') {
  const prelude = `
    const S = { user: ${JSON.stringify(user)}, page: ${JSON.stringify(page)} };
    const helpTip = () => '', L = (k) => k, _lifegroupsOn = () => true, _exportGuidesOn = () => false;
    const icS = () => '', icLg = () => '', icN = () => '';
    const fmtDay = (d) => d.toISOString().slice(0, 10);`;
  return new Function(`${prelude}\n${extractFn(html, 'esc')}\n${extractFn(html, '_importBodyHtml')}
    return _importBodyHtml;`)() as (history: unknown[]) => string;
}

describe('Import screen contract (console Friday import)', () => {
  it('the drop zone keeps #csv-file and #import-status, standalone and inside Admin', () => {
    for (const page of ['import', 'admin']) {
      const out = loadImportBody({ role: 'admin' }, page)([]);
      expect(out).toContain('id="csv-file"');
      expect(out).toContain('id="import-status"');
    }
  });
  it('the success and report strings the console scrapes are unchanged', () => {
    expect(html).toContain('Import complete: ${result.studentsAdded} added, ${result.studentsUpdated} updated, ${result.sessionsAdded} sessions');
    expect(html).toContain('Import complete: ${result.groupsAdded} groups created, ${result.studentsAdded} students added, ${result.studentsUpdated} updated, ${result.weeksAdded} weeks');
    expect(html).toContain("View import report (${issueCount} item${issueCount === 1 ? '' : 's'})");
  });
  it('both confirm modals keep a button labelled exactly "Import"', () => {
    expect(html).toMatch(/onclick="closeModal\(\);uploadServiceImport\([^"]*\)">Import<\/button>/);
    expect(html).toMatch(/onclick="closeModal\(\);uploadGroupImport\([^"]*\)">Import<\/button>/);
  });
  it('admin and director desk nav still have Import (the console clicks that link)', () => {
    const nav = new Function(`const S = { settings: {} };\n${extractFn(html, '_navItemsBase')}\nreturn _navItemsBase;`)();
    for (const role of ['admin', 'director']) {
      expect(nav({ role }).map((i: { id: string }) => i.id)).toContain('import');
    }
    expect(html).toContain("else if (p==='import') await renderImport();");
  });
  it('the nav the shell renders labels the Import link exactly "Import" (the console clicks by that text)', () => {
    const names = ['navItems', '_navSlots', 'moreItems', '_navItemsBase'];
    for (const role of ['admin', 'director']) {
      const navItems = new Function(`const S = { user: { role: '${role}' }, settings: {} };
        const _prayersOn = () => true, _busOn = () => true, _nyOn = () => true, _linkOn = () => true, L = (k) => k;
        ${names.map((n) => extractFn(html, n)).join('\n')}
        return navItems;`)();
      const it = navItems().find((i: { id: string }) => i.id === 'import');
      expect(it && it.label).toBe('Import');
    }
  });
  it('both uploads write .al-ok / .al-err alerts into #import-status', () => {
    expect(extractFn(html, '_setImportStatus')).toContain("getElementById('import-status')");
    for (const fn of ['uploadServiceImport', 'uploadGroupImport']) {
      const src = extractFn(html, fn);
      expect(src).toContain('_setImportStatus(`<div class="alert al-ok"');
      expect(src).toContain('_setImportStatus(`<div class="alert al-err">Import failed: ');
    }
  });
});

// r22 B5: the Import tab is a quiet "did Friday work?" screen.
const rec = (i: number, over: Record<string, unknown> = {}) => ({ id: 'r' + i, type: 'service', filename: `file-${i}.csv`, rowCount: 100 + i,
  studentsAdded: 1, studentsUpdated: 2, sessionsAdded: 3, status: 'ok', importedAt: `2026-10-${String(20 - i).padStart(2, '0')}T10:00:00Z`, ...over });

describe('Import tab tidy (B5)', () => {
  it('inside Admin there is no second page header; the standalone page keeps it', () => {
    expect(loadImportBody({ role: 'admin' }, 'admin')([])).not.toContain('ph-title');
    expect(loadImportBody({ role: 'director' }, 'import')([])).toContain('ph-title');
  });
  it('no Clear All and no per-row delete', () => {
    const out = loadImportBody({ role: 'admin' }, 'admin')([rec(1)]);
    expect(out).not.toMatch(/Clear All|trash|deleteImportEntry|clearAllImportHistory/);
    expect(html).not.toMatch(/function (deleteImportEntry|doDeleteImportEntry|clearAllImportHistory)\(/);
  });
  it('history shows the newest 6 rows, the rest behind "Show all (10)"', () => {
    const out = loadImportBody()(Array.from({ length: 10 }, (_, i) => rec(i)));
    const fold = out.indexOf('Show all (10)');
    expect(fold).toBeGreaterThan(-1);
    for (let i = 0; i < 6; i++) expect(out.indexOf(`file-${i}.csv`)).toBeLessThan(fold);
    for (let i = 6; i < 10; i++) expect(out.indexOf(`file-${i}.csv`)).toBeGreaterThan(fold);
    expect(out).toContain("_drop('ih-more')");
    expect(loadImportBody()(Array.from({ length: 6 }, (_, i) => rec(i)))).not.toContain('Show all');
  });
  it('a last-import line for each kind, from the newest row of that kind', () => {
    const out = loadImportBody()([rec(1, { type: 'lifegroup', status: 'error' }), rec(2), rec(3)]);
    expect(out).toContain('Last service import: 2026-10-18 · 102 rows · OK');
    expect(out).toContain('Last group import: 2026-10-19 · 101 rows · Failed');
    expect(out.indexOf('Last service import')).toBeLessThan(out.indexOf('id="csv-file"'));
    expect(loadImportBody()([rec(2)])).not.toContain('Last group import');
    expect(loadImportBody()([])).not.toContain('Last ');
  });
});
