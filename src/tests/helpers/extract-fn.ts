import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadIndexHtml(): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'public', 'index.html'), 'utf8');
}

// Pulls the REAL source of a top-level `function name(...) {...}` out of the shipped HTML.
export function extractFn(source: string, name: string): string {
  const re = new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) throw new Error(`could not find function ${name} in index.html`);
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(m.index, i + 1);
}

export function countFn(source: string, name: string): number {
  return (source.match(new RegExp(`function ${name}\\(`, 'g')) ?? []).length;
}

// Evaluate several extracted functions together and return the named ones.
export function loadFns(names: string[], prelude = '', returns: string[] = names): Record<string, any> {
  const src = loadIndexHtml();
  const body = names.map((n) => extractFn(src, n)).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${body}\nreturn { ${returns.join(', ')} };`)();
}
