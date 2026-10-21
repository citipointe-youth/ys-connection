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
});
