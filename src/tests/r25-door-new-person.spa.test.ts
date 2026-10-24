// r25: the check-in door's no-results "Add '<name>' as a new person" fills the New person form, with nyOpen's C-B5 guard.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const SRC = ['nyReset', '_lkNyFromDoor'].map((n) => extractFn(loadIndexHtml(), n)).join('\n');
function run(search: string, ny: Record<string, unknown>) {
  const env = new Function('LINK', 'NY0', 'go', `let NY = NY0; ${SRC}; _lkNyFromDoor(); return NY;`);
  const went: string[] = [];
  const NY = env({ q: { search } }, { keep: null, sibling: false, sending: false, result: null, last: null, error: null, unknown: false, ...ny },
    (p: string) => went.push(p));
  return { NY, went };
}

describe('r25 door: Add as a new person', () => {
  it('first word = first name, the rest = last name, then the form', () => {
    const { NY, went } = run('  Mary Jane  van Dyke ', { keep: { firstName: 'Old' } });
    expect(NY.keep).toEqual({ firstName: 'Mary', lastName: 'Jane van Dyke' });
    expect(NY.sending).toBe(false);
    expect(went).toEqual(['new-youth']);
    expect(run('Cher', {}).NY.keep).toEqual({ firstName: 'Cher', lastName: '' });
  });
  it('C-B5: a send in flight or an unseen outcome is shown, never reset', () => {
    const r = { student: 'sent' };
    expect(run('Amy Ng', { sending: true }).NY.keep).toBeNull();
    expect(run('Amy Ng', { result: r, seen: false }).NY.result).toBe(r);
    expect(run('Amy Ng', { unknown: true }).NY.unknown).toBe(true);
    expect(run('Amy Ng', { result: r, seen: true }).NY.keep).toEqual({ firstName: 'Amy', lastName: 'Ng' });
  });
  it('the button escapes the typed name and only shows when New person is on', () => {
    const html = loadIndexHtml();
    expect(html).toContain("const add = typed && _nyOn() ?");
    expect(html).toContain("${esc(`Add '${q}' as a new person`)}");
  });
});
