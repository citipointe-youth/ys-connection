import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Y4-1: every name the SPA's inline scripts use resolves (TypeScript checkJs over the real scripts), and every
// function an inline on*= handler calls is declared. Replaces link-globals.test.ts (2026-10-12: a helper declared
// inside an IIFE was called from outside it and the screen stayed on "Loading...").
const ALLOWED = new Set(['XLSX', 'PasswordCredential']); // XLSX is a CDN global; PasswordCredential is not in lib.dom
const CODES = new Set([2304, 2552, 2448, 2454]);

const SCRIPT_RE = /^<script(?![^>]*\bsrc=)[^>]*>\r?\n([\s\S]*?)^<\/script>/gim; // scripts/check-spa-syntax.js:10

function analyse(html: string) {
  const scripts = [...html.matchAll(SCRIPT_RE)].map((m) => m[1]!);
  const files = new Map(scripts.map((s, i) => [`/spa/script${i}.js`, s]));
  const opts: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(opts);
  const realRead = host.readFile.bind(host), realFile = host.fileExists.bind(host), realSrc = host.getSourceFile.bind(host);
  host.fileExists = (f) => files.has(f) || realFile(f);
  host.readFile = (f) => files.get(f) ?? realRead(f);
  host.getSourceFile = (f, l, ...r) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, l) : realSrc(f, l, ...r));
  const program = ts.createProgram([...files.keys()], opts, host);
  const unresolved = new Set<string>();
  for (const f of files.keys()) {
    for (const d of program.getSemanticDiagnostics(program.getSourceFile(f))) {
      if (!CODES.has(d.code)) continue;
      const name = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '))?.[1];
      if (name) unresolved.add(name);
    }
  }
  // Names in scope at the top of the first script: its own top-level declarations plus the browser's globals.
  const checker = program.getTypeChecker();
  const first = program.getSourceFile('/spa/script0.js')!;
  const inScope = new Set<string>();
  for (const f of files.keys()) {
    program.getSourceFile(f)!.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name) inScope.add(n.name.text);
      if (ts.isClassDeclaration(n) && n.name) inScope.add(n.name.text);
      if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) inScope.add(d.name.text);
    });
  }
  for (const s of checker.getSymbolsInScope(first, ts.SymbolFlags.Value)) inScope.add(s.name);
  return { unresolved, inScope };
}

// Identifiers called directly (not as a method, not a keyword) in every inline on*="..." / on*='...' handler.
function handlerCalls(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bon[a-z]+=(?:"([^"]*)"|'([^']*)')/g)) {
    const code = (m[1] ?? m[2]!).replace(/\$\{[^}]*\}/g, '').replace(/'[^']*'/g, "''").replace(/&quot;|&#39;|&amp;/g, ' ');
    const local = new Set([...code.matchAll(/\b(?:const|let|var)\s+([\w$]+)/g)].map((d) => d[1]!)); // `const f=...; f()` inside the handler
    for (const c of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!local.has(c[1]!)) out.add(c[1]!);
  }
  for (const k of ['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void', 'new']) out.delete(k);
  return out;
}

const html = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const real = analyse(html);
describe('SPA names', () => {
  it('every name in the inline scripts resolves (only XLSX and PasswordCredential are outside)', () => {
    const { unresolved } = real;
    expect([...unresolved].filter((n) => !ALLOWED.has(n))).toEqual([]);
  });
  it('every function an inline on*= handler calls is declared at top level or is a browser global', () => {
    const { inScope } = real;
    expect(handlerCalls(html).size).toBeGreaterThan(100);
    expect([...handlerCalls(html)].filter((n) => !inScope.has(n)).sort()).toEqual([]);
  });
  it('catches a renamed handler call', () => {
    const bad = html.replace('onclick="elResend(', 'onclick="_noSuchHandler(');
    expect([...handlerCalls(bad)].filter((n) => !real.inScope.has(n))).toEqual(['_noSuchHandler']);
  });
  it('catches a renamed helper', () => {
    const bad = html.replace('${esc(x.name)}', '${_noSuchHelper(x.name)}');
    expect([...analyse(bad).unresolved]).toContain('_noSuchHelper');
  });
});
