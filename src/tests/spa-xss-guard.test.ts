import { describe, it, expect } from 'vitest';
import { loadIndexHtml } from './helpers/extract-fn';

// Ship gate (review S2, 2026-10-16): no text-like property may reach an HTML template literal
// in index.html without going through esc(). Three stored-XSS fixes shipped reactively
// (80a45de leader names, 7e8d69a/71bbd3e bus walk-in names); this makes the fourth a test failure.
//
// What it checks: every `${...}` inside a template literal that contains an HTML tag, in the
// inline <script>. A read of .name/.note/.text/... is a hit unless (a) an enclosing call is one
// of SAFE_WRAPPERS, (b) it is a condition operand (followed by ?, &&, ==, !=), or (c) it feeds a
// non-rendering method (.length, .localeCompare, ...). Templates without a tag (toast text,
// search keys, URLs) are skipped. Known gaps, by design: bare identifiers (`${label}`), string
// concatenation sinks ('<b>' + x.name), and JS-string-in-attribute contexts (phoneLink handles
// its own) — see S2-xss-taint.md.
const PROPS = 'name|notes?|text|address|answers?|label|title|reason|firstName|lastName|fullName|leaderName|studentName|groupName|stepName|flowName|message|email|mobile|phone|suburb|school';
// _ikKv: esc()s its value itself (B Task 7, 2026-10-17).
const SAFE_WRAPPERS = new Set(['esc', 'phoneLink', '_lkNoteCount', '_ikKv', 'localeCompare', 'includes', 'indexOf', 'startsWith', 'has', 'get', 'test']);
const NON_RENDER_AFTER = /^\s*(\)*\s*(\?|&&|===?|!==?|(\|\||&&)[^?:`]*\?)|\.(length|localeCompare|includes|indexOf|startsWith|toLowerCase|trim|split)\b)/;
// Lines reviewed and accepted (value is a constant or already-safe HTML). Keep this short.
const ALLOW: Record<number, string> = {};

type Hit = { line: number; prop: string; expr: string };

export function scanTemplates(src: string): Hit[] {
  const hits: Hit[] = [];
  const propRe = new RegExp(`\\.(${PROPS})\\b`, 'g');
  const n = src.length;
  let i = 0;
  const lineOf = (p: number) => { let l = 1; for (let k = 0; k < p; k++) if (src.charCodeAt(k) === 10) l++; return l; };
  const prevNonSpace = (p: number) => { let k = p - 1; while (k >= 0 && /\s/.test(src[k] ?? '')) k--; return k; };
  const regexOk = (p: number) => { const k = prevNonSpace(p); return k < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(src[k] ?? '') || /\b(return|typeof|case)$/.test(src.slice(Math.max(0, k - 6), k + 1)); };
  const skipStr = (q: string) => { i++; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; };
  const skipRegex = () => { i++; let cls = false; while (i < n && src[i] !== '\n') { const c = src[i]; if (c === '\\') { i += 2; continue; } if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; i++; } i++; while (/[gimsuy]/.test(src[i] || '')) i++; };
  function code(untilBrace: boolean) {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === "'" || c === '"') { skipStr(c); continue; }
      if (c === '`') { template(); continue; }
      if (c === '/' && regexOk(i)) { skipRegex(); continue; }
      if (c === '{') depth++;
      else if (c === '}') { if (untilBrace && depth === 0) return; depth--; }
      i++;
    }
  }
  function template() {
    const tplStart = i++;
    const exprs: { start: number; end: number }[] = [];
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') { i += 2; const start = i; code(true); exprs.push({ start, end: i }); i++; continue; }
      i++;
    }
    const tpl = src.slice(tplStart, i);
    if (!/<[a-zA-Z]/.test(tpl)) return; // not HTML (toast text, search key, URL)
    for (const e of exprs) {
      const text = src.slice(e.start, e.end);
      propRe.lastIndex = 0; let m: RegExpExecArray | null;
      while ((m = propRe.exec(text))) {
        if (NON_RENDER_AFTER.test(text.slice(m.index + m[0].length))) continue;
        if (wrappedSafely(text, m.index)) continue;
        const line = lineOf(e.start);
        if (ALLOW[line]) continue;
        hits.push({ line, prop: m[0], expr: text.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }
  }
  function wrappedSafely(text: string, pos: number) { // walk outward through enclosing calls
    let depth = 0;
    for (let k = pos - 1; k >= 0; k--) {
      if (text[k] === ')') depth++;
      else if (text[k] === '(') {
        if (depth > 0) { depth--; continue; }
        const id = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, k));
        if (id && SAFE_WRAPPERS.has(id[1]!)) return true;
      }
    }
    return false;
  }
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let s: RegExpExecArray | null;
  while ((s = scriptRe.exec(src))) {
    const a = s.index + s[0].indexOf('>') + 1, b = s.index + s[0].length - 9;
    i = a; while (i < b) { code(false); if (i < b) i++; }
  }
  return hits;
}

describe('XSS guard: text properties in HTML templates go through esc()', () => {
  it('flags a raw read and accepts an escaped one (self-test)', () => {
    const bad = '<script>el.innerHTML = `<b>${s.name}</b>`;</script>';
    const good = '<script>el.innerHTML = `<b>${esc(s.name)}</b>${s.name ? "y" : ""}`; toast(`${s.name} added`);</script>';
    expect(scanTemplates(bad)).toHaveLength(1);
    expect(scanTemplates(good)).toHaveLength(0);
  });

  it('index.html has no unescaped text property in an HTML template', () => {
    const hits = scanTemplates(loadIndexHtml());
    const report = hits.map((h) => `  line ${h.line}: ${h.prop} in \${${h.expr}}`).join('\n');
    expect(hits, `unescaped reads (wrap in esc() or add to ALLOW with a reason):\n${report}`).toEqual([]);
  });
});
