import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-spa-syntax.js');

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function run(body?: string) {
  let file: string | undefined;
  if (body !== undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dup-'));
    dirs.push(dir);
    file = path.join(dir, 'index.html');
    fs.writeFileSync(file, `<html>\n<script>\n${body}\n</script>\n</html>\n`);
  }
  return spawnSync(process.execPath, file ? [SCRIPT, file] : [SCRIPT], { encoding: 'utf8' });
}

describe('check-spa-syntax', () => {
  it('a duplicate function name fails, render is allowed', () => {
    const dup = run('function dupFnA(){}\nfunction dupFnA(){}');
    expect(dup.status).toBe(1);
    expect(dup.stderr).toContain('duplicate top-level function: dupFnA');
    const ok = run('function render(){}\nfunction render(){}');
    expect(ok.status).toBe(0);
    expect(run().status).toBe(0);
  });
  it('async and generator duplicates fail too', () => {
    expect(run('async function b(){}\nfunction* b(){}').status).toBe(1);
  });
});
