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
const SAFE_WRAPPERS = new Set(['esc', 'phoneLink', '_lkNoteCount', 'localeCompare', 'includes', 'indexOf', 'startsWith', 'has', 'get', 'test']);
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

// SY-01 (review 2026-10-19): esc() turns ' into &#39;, and the browser decodes it back before an
// on*= handler runs, so `onclick="f('${esc(name)}')"` lets a name close the JS string. Inside an
// on*= attribute only ids may be interpolated into a quoted JS string; look free text up in the handler.
// Not ids by name, but server-made non-text values (reviewed):
const ID_LIKE_ALLOW = new Set([
  'r.code',            // error-log code, a server constant (elWho)
  'w.start', 'd.date', 'v.run.serviceDate', // YYYY-MM-DD dates
  'LINK.pickSel',      // a serviceTimeId
]);
const isIdExpr = (e: string) => /(^|\.)(id|[a-z]\w*Id)$/.test(e) || ID_LIKE_ALLOW.has(e);

export function scanHandlerArgs(src: string): { line: number; expr: string }[] {
  const hits: { line: number; expr: string }[] = [];
  src.split('\n').forEach((text, idx) => {
    const re = /'\$\{esc\(/g; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!/\son[a-z]+="[^"]*$/.test(text.slice(0, m.index))) continue; // not inside an on*= attribute
      let depth = 1, k = m.index + m[0].length; const start = k;
      while (k < text.length && depth) { if (text[k] === '(') depth++; else if (text[k] === ')') depth--; k++; }
      const expr = text.slice(start, k - 1).trim();
      if (!isIdExpr(expr)) hits.push({ line: idx + 1, expr });
    }
  });
  return hits;
}

// Security review 2026-11-04 (LC-01): every value interpolated or concatenated inside an on*= attribute on one line must be
// _icJs(...) (or esc(JSON.stringify(...)), the same thing), Number(...), or a template id. A concatenated `.id` is NOT accepted by
// name: LC-01 was `'+p.id+'` where an audit person's id is built from a name ('n:' + fold). Multi-line handlers are out of reach, as above.
const HANDLER_ALLOW = new Set([
  // Loop indexes and numbers
  'i', 'k', 'j', 'fi', 'ii', 'oi', 'vi', 'ul', 'g', 'gap - k', 'num',
  // Server-made ids (a, b: esc()d UUIDs quoted at :12560) and fixed keys from this file's own tables, not user text
  'a', 'b', 'id', 'pid', 'rid', 'sid', 'qid', 'gid', 'key', 'kind', 'wk', 'm', 'v', 't[0]', 'prefix', 'prayerId || \'\'', 'u.status', 'l.gender||\'\'',
  'wk ? ", \'" + wk + "\'" : \'\'', 'isParent ? \'true\' : \'false\'', 'anyPlaced ? \'fit\' : \'all\'', '!r.ignored', "diff.includes('modules.intakeAdmin')",
  'g.id', 'r.id', 'to[x.kind]', // CA module: g.id is co-<grade><f/m>, r.id is lg<n> or a UUID (lane C section 3); to = a fixed table
  // Whole handler bodies built from code, never data
  'act', 'click', 'on', 'opts.click(s)', '_navClick(it)', "here && m.id === 'new-youth' ? '' : m.open",
  'resetText', "_busOn() ? ' Bus Ministry past nights are kept as a safeguarding record.' : ''",
  // phoneLink cleans its own (quote and backslash stripped, then escaped; _smsHref encodes ')
  'd', 'fn', '_smsHref(d, defaultMsg)', '_smsHref(d, _fillSmsTemplate(customTpl, firstName))',
  // A nested template is one value to this scan: these were read by hand (ids only)
  "mine ? `_icEdit(${_icJs(mine.id)})` : \"_icNew('check')\"", "warn ? `busMoveArm(this,'${riderId}','${x.id}')` : `busMove('${riderId}','${x.id}')`",
  "vehicleId ? `'${vehicleId}'` : 'null'",
]);
const safeHandlerValue = (e: string, concat: boolean) => /^(_icJs|Number)\(/.test(e) || /^esc\(JSON\.stringify\(/.test(e) || HANDLER_ALLOW.has(e)
  || (!concat && isIdExpr(e.replace(/^esc\((.*)\)$/, '$1')));

export function scanHandlerValues(src: string): { line: number; expr: string }[] {
  const hits: { line: number; expr: string }[] = [];
  src.split('\n').forEach((text, idx) => {
    const check = (e: string, concat: boolean) => { if (!safeHandlerValue(e.trim(), concat)) hits.push({ line: idx + 1, expr: e.trim() }); };
    const attrRe = /\son[a-z]+=(\\?")/g; let m: RegExpExecArray | null;
    while ((m = attrRe.exec(text))) {
      const q = m[1]!, start = m.index + m[0].length; let k = start;
      for (; k < text.length && !text.startsWith(q, k); k++) {
        if (!text.startsWith('${', k)) continue;
        let depth = 1; const s = (k += 2);
        while (k < text.length && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
        check(text.slice(s, k - 1), false);
        k--;
      }
      const concatRe = /['"]\s*\+\s*(.+?)\s*\+\s*\\?['"]/g; let c: RegExpExecArray | null;
      const attr = text.slice(start, k);
      while ((c = concatRe.exec(attr))) check(c[1]!, true);
    }
  });
  return hits;
}

describe('XSS guard: values inside on*= handlers (LC-01)', () => {
  it('flags LC-01 and free text, accepts _icJs, numbers and template ids (self-test)', () => {
    const line = (s: string) => scanHandlerValues(s).map((h) => h.expr);
    expect(line(`b+='<div onclick="CA.showPerson(\\''+p.id+'\\')">';`)).toEqual(['p.id']);
    expect(line('h=`<b onclick="del(\'${s.name}\')">`;')).toEqual(['s.name']);
    expect(line('h=`<b onclick="del(\'${esc(s.name)}\')">`;')).toEqual(['esc(s.name)']);
    expect(line(`b+='<div onclick="CA.showPerson('+_icJs(p.id)+')">';`)).toEqual([]);
    expect(line('h=`<b onclick="del(${_icJs(s.name)},${Number(n)},\'${esc(s.id)}\',\'${s.leaderId}\')">`;')).toEqual([]);
  });

  it('index.html has no unsafe value in an on*= handler', () => {
    const hits = scanHandlerValues(loadIndexHtml());
    const report = hits.map((h) => `  line ${h.line}: ${h.expr}`).join('\n');
    expect(hits, `use _icJs(value), or review it and add it to HANDLER_ALLOW:\n${report}`).toEqual([]);
  });
});

describe('XSS guard: on*= handlers pass ids only (SY-01)', () => {
  it('flags esc()d free text in a handler and accepts an id (self-test)', () => {
    expect(scanHandlerArgs(`<b onclick="del('\${esc(l.id)}','\${esc(l.fullName).replace(/'/g,"\\'")}')">`)).toHaveLength(1);
    expect(scanHandlerArgs(`<b onclick="del('\${esc(l.id)}')">\${esc(l.fullName)}</b>`)).toHaveLength(0);
  });

  it('index.html passes no esc()d free text into an on*= handler', () => {
    const hits = scanHandlerArgs(loadIndexHtml());
    const report = hits.map((h) => `  line ${h.line}: esc(${h.expr})`).join('\n');
    expect(hits, `pass the id and look the text up inside the handler:\n${report}`).toEqual([]);
  });
});
