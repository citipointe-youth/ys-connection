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
  let body = names.map((n) => extractFn(src, n)).join('\n');
  // Y3b: a function that reads the location's clock brings the site-time helpers along (and an empty S if the prelude has none).
  if (/\b(?:_site[A-Z]\w*|_tz|_tzCity|_consentCutoff|_cutoffWords)\(/.test(body) && !names.includes('_siteWall')) {
    body += '\n' + SITE_TIME_FNS.filter((n) => !names.includes(n)).map((n) => extractFn(src, n)).join('\n');
    if (!/\b(?:var|let|const) S\b/.test(prelude)) prelude = 'var S = {};\n' + prelude;
    if (!/\b_DAY_NAMES\b/.test(prelude)) prelude = SITE_TIME_CONSTS + '\n' + prelude;
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${body}\nreturn { ${returns.join(', ')} };`)();
}

// Y3b: the location's clock and consent words (structure.timeZone, serviceDayOfWeek, consentCutoff). A test that runs a
// function using them loads these too (loadFns does it by itself), with SITE_TIME_CONSTS and an `S` (settings may be absent).
export const SITE_TIME_FNS = ['_structure', '_serviceDow', '_serviceDayName', '_tz', '_tzCity', '_consentCutoff', '_cutoffWords',
  '_siteWall', '_siteDay', '_siteHHMM', '_siteInstant'];
export const SITE_TIME_CONSTS = loadIndexHtml().match(/^const _DAY_NAMES = .*$/m)![0];
// The same as one source block, for a test that builds its own `new Function` (it must declare `S`).
export const SITE_TIME_SRC = SITE_TIME_CONSTS + '\n' + SITE_TIME_FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');
