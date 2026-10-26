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
  // Modular setup: a function that asks _modOn brings it along; with no settings loaded (an empty S) unknown shows, as live.
  if (/\b_modOn\(/.test(body) && !names.includes('_modOn')) {
    body += '\n' + extractFn(src, '_modOn');
    if (!/\b(?:var|let|const) S\b/.test(prelude)) prelude = 'var S = {};\n' + prelude;
  }
  // Y4: the settings-file functions bring _dropLocationKeys and the Elvanto module list along.
  if (/\b_dropLocationKeys\(/.test(body) && !names.includes('_dropLocationKeys')) body += '\n' + extractFn(src, '_dropLocationKeys');
  if (/\b_SETUP_ELVANTO\b/.test(body) && !/\b_SETUP_ELVANTO\s*=/.test(prelude)) prelude = src.match(/^const _SETUP_ELVANTO = \[[\s\S]*?^\];/m)![0] + '\n' + prelude;
  // L7: a renderer with a Check again line brings _lkRcHtml and its state along.
  if (/\b_lkRcHtml\(/.test(body) && !names.includes('_lkRcHtml')) body += '\n' + extractFn(src, '_lkRcHtml');
  if (/\b_lkRcType\(/.test(body) && !names.includes('_lkRcType')) body += '\n' + extractFn(src, '_lkRcType');
  if (/\b_lkRcDone\(/.test(body) &&!names.includes('_lkRcDone')) body += '\n' + extractFn(src, '_lkRcDone');
  if (/\b_LK_RC\b/.test(body) && !/\b_LK_RC\s*=/.test(prelude)) prelude = 'const _LK_RC = {};\n' + prelude;
  // Rev 20: a door repaint (_lkSetSearch, _lkRefreshView) brings the door search's paint along (it paints nothing without #lk-es).
  if (/\b_lkEsPaint\(/.test(body) && !names.includes('_lkEsPaint')) body += '\n' + ES_FNS.filter((n) => !names.includes(n)).map((n) => extractFn(src, n)).join('\n');
  // Plain-language pass (2026-10-25): a function that reads _lkSay / _lkSys / _lkPlainStatus brings them (and _lkBoss) along.
  body = withPlain(body, names, prelude);
  if (/\b_lkBoss\(/.test(body) && !/\b(?:var|let|const) S\b/.test(prelude)) prelude = 'var S = {};\n' + prelude;
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${body}\nreturn { ${returns.join(', ')} };`)();
}

/** The plain-language helpers (bosses keep technical words, everyone else gets plain ones). */
export const PLAIN_FNS = ['_lkBoss', '_lkSay', '_lkSys', '_plainErr', '_lkPlainStatus', '_lkStatusText', '_nyMessageRaw', '_bcResultRaw', '_lkUnsaved', '_lkPlainToast'];
/** Appends each PLAIN_FNS helper the body calls and does not already hold (repeats until nothing new is needed). */
export function withPlain(body: string, have: string[] = [], prelude = ''): string {
  const src = loadIndexHtml(), got = new Set(have);
  // A test stub of the same name (function or const in the prelude) wins: never append the real one over it.
  for (const n of PLAIN_FNS) if (new RegExp(`(?:function\\s+${n}\\(|(?:const|let|var)\\s+${n}\\b)`).test(prelude)) got.add(n);
  for (let more = true; more;) {
    more = false;
    for (const n of PLAIN_FNS) {
      if (got.has(n) || !new RegExp(`\\b${n}\\b`).test(body) || new RegExp(`function ${n}\\(`).test(body)) continue;
      body += '\n' + extractFn(src, n); got.add(n); more = true;
    }
  }
  return body;
}

/** Rev 20: the door search's paint and what it reads (loadFns adds them; a test with its own FNS list adds ES_FNS). */
export const ES_FNS = ['_lkEsPaint', '_lkEsHtml', '_lkEsCur', '_lkEsOn'];
// Y3b: the location's clock and consent words (structure.timeZone, serviceDayOfWeek, consentCutoff). A test that runs a
// function using them loads these too (loadFns does it by itself), with SITE_TIME_CONSTS and an `S` (settings may be absent).
export const SITE_TIME_FNS = ['_structure', '_serviceDow', '_serviceDayName', '_tz', '_tzCity', '_consentCutoff', '_cutoffWords',
  '_siteWall', '_siteDay', '_siteHHMM', '_siteInstant'];
export const SITE_TIME_CONSTS = loadIndexHtml().match(/^const _DAY_NAMES = .*$/m)![0];
// The same as one source block, for a test that builds its own `new Function` (it must declare `S`).
export const SITE_TIME_SRC = SITE_TIME_CONSTS + '\n' + SITE_TIME_FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');
